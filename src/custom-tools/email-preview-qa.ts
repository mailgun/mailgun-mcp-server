// Shared local helpers for the Email Preview QA composites (get_email_preview_qa
// and run_email_preview_qa). These are intentionally feature-local: V2 paths,
// status parsing, polling, and count helpers live here, not in a generalized
// adapter framework.
//
// The normalized output shape defined here is the contract that must stay
// equivalent between the MCP composites and the Mailgun CLI (spec §12, §16.1).
// It contains mechanical counts and result references only — never a
// Mailgun-authored pass/fail verdict, never raw upstream payloads, never HTML,
// and never individual issue records.

// --- Vocabulary ---

export type RenderStatus = "complete" | "processing" | "partial" | "unknown";

export type CheckLifecycle =
  | "not_requested"
  | "processing"
  | "complete"
  | "job_failed"
  | "unavailable";

export type CheckName = "link_validation" | "image_validation" | "accessibility" | "code_analysis";

export const CHECK_NAMES: readonly CheckName[] = [
  "link_validation",
  "image_validation",
  "accessibility",
  "code_analysis",
];

export interface DataGap {
  code: string;
  product: string;
  message: string;
  impact: string;
}

export interface PreviewWarning {
  name: string | null;
  message: string | null;
}

// --- Output shape (the parity contract) ---

export interface LinkImageCheckSummary {
  status: CheckLifecycle;
  result_id: string | null;
  passes: number;
  failures: number;
  informational: number;
  by_severity: Record<string, number>;
}

export interface AccessibilityCheckSummary {
  status: CheckLifecycle;
  result_id: string | null;
  // Headline counts are INSTANCE-level (one WCAG problem occurrence); rule counts
  // are the number of distinct rules that flagged, kept as a secondary signal.
  failures: number;
  failure_rules: number;
  needs_review: number;
  needs_review_rules: number;
  failures_by_severity: Record<string, number>;
  needs_review_by_severity: Record<string, number>;
}

// Support-breakdown objects are passed through from the authoritative analyze
// `meta` block (e.g. { supported, partial_support, unsupported, unknown }); we do
// not recompute them.
export type SupportBreakdown = Record<string, unknown>;

export interface CodeAnalysisCheckSummary {
  status: CheckLifecycle;
  result_id: string | null;
  // `count` is the canonical total from analyze `meta.count` (== number of
  // detected features). `instances` is the sum of per-feature occurrences.
  count: number;
  instances: number;
  by_feature: Record<string, number>;
  application_support: SupportBreakdown;
  inbox_provider_support: SupportBreakdown;
  market_support: SupportBreakdown;
}

export interface EmailPreviewQaOutput {
  test_id: string;
  status: RenderStatus;
  timed_out: boolean;
  summary: { total_clients: number; completed: number; processing: number; bounced: number };
  clients: { completed: string[]; processing: string[]; bounced: string[] };
  checks: {
    link_validation: LinkImageCheckSummary;
    image_validation: LinkImageCheckSummary;
    accessibility: AccessibilityCheckSummary;
    code_analysis: CodeAnalysisCheckSummary;
  };
  issue_counts: {
    total: number;
    by_check: Record<string, number>;
    by_severity: Record<string, number>;
    by_check_and_severity: Record<string, Record<string, number>>;
  };
  warnings: PreviewWarning[];
  data_gaps: DataGap[];
}

const PRODUCT = "Inspect";

// --- Small value helpers (defensive against upstream shape drift) ---

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === "string");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Native severity/impact label, case-normalized only. Never mapped onto a
// shared Mailgun scale (spec §12.4). Missing/blank labels bucket as "unknown".
function severityLabel(value: unknown): string {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  return s.length > 0 ? s : "unknown";
}

function increment(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

// --- Render state ---

export interface RenderState {
  status: RenderStatus;
  completed: string[];
  processing: string[];
  bounced: string[];
}

export function normalizeRenderState(render: unknown): RenderState {
  const record = asRecord(render);
  const completed = stringArray(record.completed);
  const processing = stringArray(record.processing);
  const bounced = stringArray(record.bounced);

  let status: RenderStatus;
  if (completed.length + processing.length + bounced.length === 0) status = "unknown";
  else if (processing.length > 0) status = "processing";
  else if (bounced.length > 0) status = "partial";
  else status = "complete";

  return { status, completed, processing, bounced };
}

// --- Check references ---

export interface CheckReference {
  requested: boolean;
  hasErrors: boolean;
  resultId: string | null;
}

// Extract, per check, whether it was requested, whether its job errored, and
// the result id used to build the allowlisted detail path. A `null` value under
// content_checking means the check was not requested.
export function extractCheckResultIds(render: unknown): Record<CheckName, CheckReference> {
  const cc = asRecord(asRecord(render).content_checking);
  const result = {} as Record<CheckName, CheckReference>;
  for (const name of CHECK_NAMES) {
    const raw = cc[name];
    if (raw === null || raw === undefined) {
      result[name] = { requested: false, hasErrors: false, resultId: null };
      continue;
    }
    const node = asRecord(raw);
    const hasErrors = asArray(node.errors).length > 0;
    const items = asRecord(node.items);
    result[name] = { requested: true, hasErrors, resultId: str(items.id) };
  }
  return result;
}

// Build the allowlisted result path from a validated result id. We never blindly
// follow an upstream `self`; we construct the known path on the configured host
// (spec §11.4).
export function checkResultPath(name: CheckName, resultId: string): string {
  const id = encodeURIComponent(resultId);
  switch (name) {
    case "link_validation":
      return `/v1/inspect/links/${id}`;
    case "image_validation":
      return `/v1/inspect/images/${id}`;
    case "accessibility":
      return `/v1/inspect/accessibility/${id}`;
    case "code_analysis":
      return `/v1/inspect/analyze/${id}`;
  }
}

// --- Check fetch outcome (produced by the poller, consumed by the builder) ---

export type CheckFetchStatus = "ok" | "not_found" | "error" | "not_fetched";

export interface CheckFetch {
  status: CheckFetchStatus;
  payload?: unknown;
}

// Read the per-check completion signal from the DETAIL payload's meta.status.
// The status/render endpoint's per-check meta can be stale, so we trust the
// detail payload. Casing is inconsistent across checks ("Completed" vs
// "Complete"), so match case-insensitively by prefix. A missing meta.status on a
// 200 response is treated as complete (we have a materialized payload).
export function detailStatus(payload: unknown): "complete" | "processing" {
  const raw = severityLabel(asRecord(asRecord(payload).meta).status);
  if (
    raw.startsWith("process") ||
    raw.startsWith("pending") ||
    raw.startsWith("queu") ||
    raw.startsWith("run")
  ) {
    return "processing";
  }
  return "complete";
}

// True once a requested check has reached a state we will not poll past: its job
// errored, its detail payload is complete, or its detail endpoint is
// unavailable. A check whose reference has not materialized yet, or whose detail
// payload still reports "processing", is NOT terminal. Checks are independent of
// per-client rendering, so a slow render never keeps a settled check pending.
export function isCheckTerminal(ref: CheckReference, fetch: CheckFetch): boolean {
  if (!ref.requested) return true;
  if (ref.hasErrors) return true;
  if (ref.resultId === null) return false;
  if (fetch.status === "ok") return detailStatus(fetch.payload) !== "processing";
  if (fetch.status === "not_found" || fetch.status === "error") return true;
  return false; // not_fetched
}

// Lifecycle is derived from the reference + the detail fetch outcome. `timedOut`
// only affects checks whose reference never materialized: at a timeout they are
// still "processing"; otherwise a missing reference is genuinely "unavailable".
export function normalizeCheckLifecycle(
  ref: CheckReference,
  fetch: CheckFetch,
  timedOut: boolean,
): CheckLifecycle {
  if (!ref.requested) return "not_requested";
  if (ref.hasErrors) return "job_failed";
  if (ref.resultId === null) return timedOut ? "processing" : "unavailable";
  if (fetch.status === "ok") return detailStatus(fetch.payload) === "processing" ? "processing" : "complete";
  if (fetch.status === "not_found") return "unavailable";
  if (fetch.status === "error") return "unavailable";
  return "processing"; // requested, referenced, but not fetched by the deadline
}

// --- Issue counters (traceable to V2 schema fields) ---

interface LinkImageCounts {
  passes: number;
  failures: number;
  informational: number;
  by_severity: Record<string, number>;
}

function countFindingBuckets(entries: unknown[]): LinkImageCounts {
  const counts: LinkImageCounts = { passes: 0, failures: 0, informational: 0, by_severity: {} };
  for (const entry of entries) {
    const record = asRecord(entry);
    counts.passes += asArray(record.passes).length;
    counts.informational += asArray(record.informational).length;
    const failures = asArray(record.failures);
    counts.failures += failures.length;
    for (const failure of failures) {
      increment(counts.by_severity, severityLabel(asRecord(failure).impact));
    }
  }
  return counts;
}

export function countLinkValidationIssues(payload: unknown): LinkImageCounts {
  const results = asArray(asRecord(asRecord(payload).items).results);
  return countFindingBuckets(results);
}

export function countImageValidationIssues(payload: unknown): LinkImageCounts {
  const images = asArray(asRecord(asRecord(payload).items).images);
  return countFindingBuckets(images);
}

interface AccessibilityCounts {
  failures: number;
  failure_rules: number;
  needs_review: number;
  needs_review_rules: number;
  failures_by_severity: Record<string, number>;
  needs_review_by_severity: Record<string, number>;
}

// Accessibility failures/needs_review are grouped by RULE, each carrying an
// instances[] array. We count INSTANCES as the headline (one occurrence of a
// problem) and keep the rule count as a secondary signal. A rule entry with no
// instances[] counts as a single occurrence.
function countRuleGroups(
  entries: unknown[],
): { instances: number; rules: number; bySeverity: Record<string, number> } {
  let instances = 0;
  let rules = 0;
  const bySeverity: Record<string, number> = {};
  for (const entry of entries) {
    const record = asRecord(entry);
    const occurrences = asArray(record.instances);
    const n = occurrences.length > 0 ? occurrences.length : 1;
    rules += 1;
    instances += n;
    increment(bySeverity, severityLabel(record.impact), n);
  }
  return { instances, rules, bySeverity };
}

export function countAccessibilityIssues(payload: unknown): AccessibilityCounts {
  const counts: AccessibilityCounts = {
    failures: 0,
    failure_rules: 0,
    needs_review: 0,
    needs_review_rules: 0,
    failures_by_severity: {},
    needs_review_by_severity: {},
  };
  // items is an array of result groups.
  for (const group of asArray(asRecord(payload).items)) {
    const record = asRecord(group);
    const f = countRuleGroups(asArray(record.failures));
    counts.failures += f.instances;
    counts.failure_rules += f.rules;
    for (const [sev, n] of Object.entries(f.bySeverity)) increment(counts.failures_by_severity, sev, n);

    const r = countRuleGroups(asArray(record.needs_review));
    counts.needs_review += r.instances;
    counts.needs_review_rules += r.rules;
    for (const [sev, n] of Object.entries(r.bySeverity)) increment(counts.needs_review_by_severity, sev, n);
  }
  return counts;
}

interface CodeAnalysisCounts {
  count: number;
  instances: number;
  by_feature: Record<string, number>;
  application_support: Record<string, unknown>;
  inbox_provider_support: Record<string, unknown>;
  market_support: Record<string, unknown>;
}

// Code-analysis counting uses the authoritative analyze `meta` block confirmed
// against the live V2 API: `meta.count` is the canonical total (== number of
// detected features), and `meta.*_support` are precomputed aggregates we pass
// through verbatim. `instances` (sum of per-feature occurrences) and `by_feature`
// are derived directly from items.features for drill-down.
export function countCodeAnalysisIssues(payload: unknown): CodeAnalysisCounts {
  const meta = asRecord(asRecord(payload).meta);
  const features = asArray(asRecord(asRecord(payload).items).features);

  const by_feature: Record<string, number> = {};
  let instances = 0;
  for (const feature of features) {
    const record = asRecord(feature);
    const slug = str(record.slug) ?? str(record.name) ?? "unknown";
    const instanceCount = asArray(record.instances).length;
    increment(by_feature, slug, instanceCount);
    instances += instanceCount;
  }

  const count = typeof meta.count === "number" ? meta.count : features.length;

  return {
    count,
    instances,
    by_feature,
    application_support: asRecord(meta.application_support),
    inbox_provider_support: asRecord(meta.inbox_provider_support),
    market_support: asRecord(meta.market_support),
  };
}

// --- Warnings ---

export function normalizeWarnings(create: unknown): PreviewWarning[] {
  return asArray(asRecord(create).warnings).map((w) => {
    const record = asRecord(w);
    return { name: str(record.name), message: str(record.message) };
  });
}

// --- Create request (used by the run composite) ---

export interface PreviewCreateInput {
  subject: string;
  html: string;
  clients?: readonly string[];
  // Which structured checks to enable. Defaults to all four when undefined; an
  // empty array means "no checks".
  contentChecks?: readonly CheckName[];
  referenceId?: string;
}

// Build the JSON body for POST /v2/preview/tests. Only the HTML source is used
// (spec §9.1). `clients` is omitted when absent, `content_checking` always sends
// explicit booleans for all four checks, and `reference_id` is omitted when
// absent (spec §10).
export function buildPreviewCreateRequest(input: PreviewCreateInput): Record<string, unknown> {
  const body: Record<string, unknown> = { subject: input.subject, html: input.html };
  if (input.clients && input.clients.length > 0) body.clients = [...input.clients];

  const requested = input.contentChecks ?? CHECK_NAMES;
  const contentChecking: Record<string, boolean> = {};
  for (const name of CHECK_NAMES) contentChecking[name] = requested.includes(name);
  body.content_checking = contentChecking;

  if (input.referenceId) body.reference_id = input.referenceId;
  return body;
}

export function extractCreatedTestId(created: unknown): string | null {
  return str(asRecord(created).id);
}

// --- Output builder (pure) ---

export interface BuildOutputParams {
  testId: string;
  render: unknown;
  refs: Record<CheckName, CheckReference>;
  fetches: Record<CheckName, CheckFetch>;
  timedOut: boolean;
  warnings?: PreviewWarning[];
}

export function buildEmailPreviewQaOutput(params: BuildOutputParams): EmailPreviewQaOutput {
  const { testId, render, refs, fetches, timedOut } = params;
  const renderState = normalizeRenderState(render);
  const dataGaps: DataGap[] = [];

  if (renderState.status === "unknown") {
    dataGaps.push({
      code: "render_clients_unavailable",
      product: PRODUCT,
      message: "No client rendering state was returned for this test.",
      impact: "Per-client completion status becomes available once the preview finishes processing.",
    });
  } else if (renderState.processing.length > 0) {
    // Per-client rendering is independent of content checks: a slow/stuck client
    // does not block the result. We report it as a non-fatal gap (mirroring the
    // Inspect UI, which marks missing clients rather than blocking).
    dataGaps.push({
      code: "render_incomplete",
      product: PRODUCT,
      message: `${renderState.processing.length} client render(s) had not finished when results were returned.`,
      impact:
        "Screenshot rendering for some clients is still processing; content checks are unaffected. Resume with the same test id to collect the remaining renders.",
    });
  }

  const lifecycleFor = (name: CheckName): CheckLifecycle =>
    normalizeCheckLifecycle(refs[name], fetches[name], timedOut);

  const addRefGap = (name: CheckName, lifecycle: CheckLifecycle): void => {
    if (lifecycle === "unavailable" && refs[name].requested) {
      if (refs[name].resultId === null) {
        dataGaps.push({
          code: "check_reference_missing",
          product: PRODUCT,
          message: `The ${name} check did not expose a result reference.`,
          impact: `Detailed ${name} results cannot be retrieved for this test.`,
        });
      } else {
        dataGaps.push({
          code: "result_endpoint_unavailable",
          product: PRODUCT,
          message: `The ${name} result endpoint was unavailable.`,
          impact: `Detailed ${name} results could not be retrieved and are not counted.`,
        });
      }
    }
  };

  const linkLifecycle = lifecycleFor("link_validation");
  addRefGap("link_validation", linkLifecycle);
  const linkCounts =
    linkLifecycle === "complete"
      ? countLinkValidationIssues(fetches.link_validation.payload)
      : { passes: 0, failures: 0, informational: 0, by_severity: {} };

  const imageLifecycle = lifecycleFor("image_validation");
  addRefGap("image_validation", imageLifecycle);
  const imageCounts =
    imageLifecycle === "complete"
      ? countImageValidationIssues(fetches.image_validation.payload)
      : { passes: 0, failures: 0, informational: 0, by_severity: {} };

  const a11yLifecycle = lifecycleFor("accessibility");
  addRefGap("accessibility", a11yLifecycle);
  const a11yCounts =
    a11yLifecycle === "complete"
      ? countAccessibilityIssues(fetches.accessibility.payload)
      : {
          failures: 0,
          failure_rules: 0,
          needs_review: 0,
          needs_review_rules: 0,
          failures_by_severity: {},
          needs_review_by_severity: {},
        };

  const codeLifecycle = lifecycleFor("code_analysis");
  addRefGap("code_analysis", codeLifecycle);
  const codeCounts =
    codeLifecycle === "complete"
      ? countCodeAnalysisIssues(fetches.code_analysis.payload)
      : {
          count: 0,
          instances: 0,
          by_feature: {},
          application_support: {},
          inbox_provider_support: {},
          market_support: {},
        };

  if (timedOut) {
    dataGaps.push({
      code: "workflow_timed_out",
      product: PRODUCT,
      message: "The workflow deadline was reached while work was still processing.",
      impact: "Some render or check results may be incomplete; resume with the same test id.",
    });
  }

  // Cross-check issue aggregates (link/image/accessibility failures). Code
  // analysis is reported separately and not folded into these severity totals.
  const byCheck: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byCheckAndSeverity: Record<string, Record<string, number>> = {};

  const foldFailures = (name: string, failures: number, bySev: Record<string, number>): void => {
    if (failures > 0) byCheck[name] = failures;
    for (const [sev, count] of Object.entries(bySev)) {
      increment(bySeverity, sev, count);
      byCheckAndSeverity[name] = byCheckAndSeverity[name] ?? {};
      increment(byCheckAndSeverity[name], sev, count);
    }
  };
  foldFailures("link_validation", linkCounts.failures, linkCounts.by_severity);
  foldFailures("image_validation", imageCounts.failures, imageCounts.by_severity);
  foldFailures("accessibility", a11yCounts.failures, a11yCounts.failures_by_severity);

  const totalIssues =
    linkCounts.failures + imageCounts.failures + a11yCounts.failures;

  return {
    test_id: testId,
    status: renderState.status,
    timed_out: timedOut,
    summary: {
      total_clients:
        renderState.completed.length + renderState.processing.length + renderState.bounced.length,
      completed: renderState.completed.length,
      processing: renderState.processing.length,
      bounced: renderState.bounced.length,
    },
    clients: {
      completed: renderState.completed,
      processing: renderState.processing,
      bounced: renderState.bounced,
    },
    checks: {
      link_validation: {
        status: linkLifecycle,
        result_id: refs.link_validation.resultId,
        passes: linkCounts.passes,
        failures: linkCounts.failures,
        informational: linkCounts.informational,
        by_severity: linkCounts.by_severity,
      },
      image_validation: {
        status: imageLifecycle,
        result_id: refs.image_validation.resultId,
        passes: imageCounts.passes,
        failures: imageCounts.failures,
        informational: imageCounts.informational,
        by_severity: imageCounts.by_severity,
      },
      accessibility: {
        status: a11yLifecycle,
        result_id: refs.accessibility.resultId,
        failures: a11yCounts.failures,
        failure_rules: a11yCounts.failure_rules,
        needs_review: a11yCounts.needs_review,
        needs_review_rules: a11yCounts.needs_review_rules,
        failures_by_severity: a11yCounts.failures_by_severity,
        needs_review_by_severity: a11yCounts.needs_review_by_severity,
      },
      code_analysis: {
        status: codeLifecycle,
        result_id: refs.code_analysis.resultId,
        count: codeCounts.count,
        instances: codeCounts.instances,
        by_feature: codeCounts.by_feature,
        application_support: codeCounts.application_support,
        inbox_provider_support: codeCounts.inbox_provider_support,
        market_support: codeCounts.market_support,
      },
    },
    issue_counts: {
      total: totalIssues,
      by_check: byCheck,
      by_severity: bySeverity,
      by_check_and_severity: byCheckAndSeverity,
    },
    warnings: params.warnings ?? [],
    data_gaps: dataGaps,
  };
}

// --- Polling orchestration (I/O injected for deterministic tests) ---

export type RequestFn = (method: string, path: string, body?: unknown) => Promise<unknown>;

export interface PollDeps {
  request: RequestFn;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface PollParams {
  testId: string;
  timeoutMs: number;
  intervalMs?: number;
}

export interface PollResult {
  render: unknown;
  refs: Record<CheckName, CheckReference>;
  fetches: Record<CheckName, CheckFetch>;
  timedOut: boolean;
}

const POLL_INTERVAL_MS = 5000;

function isNotFound(error: unknown): boolean {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 404;
}

// Fetch the referenced structured-check results concurrently (bounded — at most
// four checks). A requested check with no reference yet, or whose job errored, is
// left unfetched. Independent of per-client rendering.
async function fetchCheckResults(
  refs: Record<CheckName, CheckReference>,
  deps: PollDeps,
): Promise<Record<CheckName, CheckFetch>> {
  const fetches = {} as Record<CheckName, CheckFetch>;
  await Promise.all(
    CHECK_NAMES.map(async (name) => {
      const ref = refs[name];
      if (!ref.requested || ref.hasErrors || ref.resultId === null) {
        fetches[name] = { status: "not_fetched" };
        return;
      }
      try {
        const payload = await deps.request("GET", checkResultPath(name, ref.resultId));
        fetches[name] = { status: "ok", payload };
      } catch (error) {
        fetches[name] = { status: isNotFound(error) ? "not_found" : "error" };
      }
    }),
  );
  return fetches;
}

// Poll until every REQUESTED content check reaches a terminal state (complete,
// job_failed, or unavailable) or the deadline passes. Completion is driven by the
// checks, NOT by per-client rendering: a slow/stuck client can keep the render
// "processing" indefinitely, so we never block on it (mirrors the Inspect UI).
// Only GETs are issued here; creation happens outside this function.
export async function pollEmailPreviewQa(
  params: PollParams,
  deps: PollDeps,
): Promise<PollResult> {
  const interval = params.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = deps.now() + params.timeoutMs;
  const statusPath = `/v2/preview/tests/${encodeURIComponent(params.testId)}`;

  let render: unknown = await deps.request("GET", statusPath);
  let refs = extractCheckResultIds(render);
  let fetches = await fetchCheckResults(refs, deps);
  let timedOut = false;

  const allChecksTerminal = (): boolean =>
    CHECK_NAMES.every((name) => isCheckTerminal(refs[name], fetches[name]));

  while (!allChecksTerminal()) {
    if (deps.now() + interval > deadline) {
      timedOut = true;
      break;
    }
    await deps.sleep(interval);
    render = await deps.request("GET", statusPath);
    refs = extractCheckResultIds(render);
    fetches = await fetchCheckResults(refs, deps);
  }

  return { render, refs, fetches, timedOut };
}
