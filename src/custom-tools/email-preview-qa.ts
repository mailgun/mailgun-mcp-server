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

// --- Output shape ---

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
  // Headline counts are instance-level; *_rules are distinct-rule counts.
  failures: number;
  failure_rules: number;
  needs_review: number;
  needs_review_rules: number;
  failures_by_severity: Record<string, number>;
  needs_review_by_severity: Record<string, number>;
}

// Passed through from the analyze `meta` block; not recomputed.
export type SupportBreakdown = Record<string, unknown>;

export interface CodeAnalysisCheckSummary {
  status: CheckLifecycle;
  result_id: string | null;
  // count = analyze meta.count (feature total); instances = sum of occurrences.
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

// --- Value helpers ---

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

// Lifecycle status matching is case-insensitive: lowercased + trimmed for
// comparison only, never for display.
function statusToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// Native severity/impact bucket. Only whitespace is trimmed; the API's spelling
// and casing are preserved. Blank/missing values bucket as "unknown".
function severityBucket(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
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
  // A non-null check node was returned under content_checking (the reference
  // materialized), even if it exposed neither a result id nor errors. This tells
  // an exposed-but-empty node (terminal, unavailable) apart from an absent-but-
  // requested one (still pending).
  exposed: boolean;
  hasErrors: boolean;
  resultId: string | null;
}

// Classify each content_checking node:
//   explicit null      -> not requested;
//   absent property    -> pending if the check was requested at create time,
//                         otherwise not requested;
//   node with a result id -> referenced;
//   node with errors[] -> job failed;
//   node with neither  -> exposed but unavailable (a data gap).
// `requestedChecks` carries the validated create-time selection so an absent
// property can be distinguished from a not-requested one. The resume tool cannot
// recover that selection from the status API; when it is omitted, an absent
// property is treated as pending (never terminated after a single read).
export function extractCheckResultIds(
  render: unknown,
  requestedChecks?: ReadonlySet<CheckName>,
): Record<CheckName, CheckReference> {
  const cc = asRecord(asRecord(render).content_checking);
  const result = {} as Record<CheckName, CheckReference>;
  for (const name of CHECK_NAMES) {
    const raw = cc[name];
    if (raw === null) {
      result[name] = { requested: false, exposed: false, hasErrors: false, resultId: null };
      continue;
    }
    if (raw === undefined) {
      const requested = requestedChecks ? requestedChecks.has(name) : true;
      result[name] = { requested, exposed: false, hasErrors: false, resultId: null };
      continue;
    }
    const node = asRecord(raw);
    const hasErrors = asArray(node.errors).length > 0;
    const items = asRecord(node.items);
    result[name] = { requested: true, exposed: true, hasErrors, resultId: str(items.id) };
  }
  return result;
}

// Construct the known allowlisted path from a validated result id; never follow an upstream `self`.
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

// --- Check fetch outcome ---

export type CheckFetchStatus = "ok" | "not_found" | "not_fetched";

export interface CheckFetch {
  status: CheckFetchStatus;
  payload?: unknown;
}

// Completion signal from the detail payload's meta.status (case-insensitive; missing = complete).
export function detailStatus(payload: unknown): "complete" | "processing" {
  const raw = statusToken(asRecord(asRecord(payload).meta).status);
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

// A requested check is terminal once its job errored, its detail is complete, or
// its endpoint is unavailable. Independent of per-client rendering.
export function isCheckTerminal(ref: CheckReference, fetch: CheckFetch): boolean {
  if (!ref.requested) return true;
  if (ref.hasErrors) return true;
  if (ref.resultId !== null) {
    if (fetch.status === "ok") return detailStatus(fetch.payload) !== "processing";
    if (fetch.status === "not_found") return true;
    return false; // not_fetched
  }
  // No result id yet: an exposed-but-empty node is terminal (unavailable); an
  // absent-but-requested reference is still pending.
  return ref.exposed;
}

// Derived from the reference + detail fetch. An exposed-but-empty reference is
// unavailable; an absent-but-requested one stays "processing" (it only reaches
// output construction when the deadline was hit while still pending).
export function normalizeCheckLifecycle(ref: CheckReference, fetch: CheckFetch): CheckLifecycle {
  if (!ref.requested) return "not_requested";
  if (ref.hasErrors) return "job_failed";
  if (ref.resultId !== null) {
    if (fetch.status === "ok")
      return detailStatus(fetch.payload) === "processing" ? "processing" : "complete";
    if (fetch.status === "not_found") return "unavailable";
    return "processing"; // referenced but not fetched by the deadline
  }
  return ref.exposed ? "unavailable" : "processing";
}

// --- Issue counters ---

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
      increment(counts.by_severity, severityBucket(asRecord(failure).impact));
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

// Rules carry an instances[] array. Count instances as the headline and rules as a
// secondary signal; a rule with no instances[] counts as one occurrence.
function countRuleGroups(entries: unknown[]): {
  instances: number;
  rules: number;
  bySeverity: Record<string, number>;
} {
  let instances = 0;
  let rules = 0;
  const bySeverity: Record<string, number> = {};
  for (const entry of entries) {
    const record = asRecord(entry);
    const occurrences = asArray(record.instances);
    const n = occurrences.length > 0 ? occurrences.length : 1;
    rules += 1;
    instances += n;
    increment(bySeverity, severityBucket(record.impact), n);
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
  for (const group of asArray(asRecord(payload).items)) {
    const record = asRecord(group);
    const f = countRuleGroups(asArray(record.failures));
    counts.failures += f.instances;
    counts.failure_rules += f.rules;
    for (const [sev, n] of Object.entries(f.bySeverity))
      increment(counts.failures_by_severity, sev, n);

    const r = countRuleGroups(asArray(record.needs_review));
    counts.needs_review += r.instances;
    counts.needs_review_rules += r.rules;
    for (const [sev, n] of Object.entries(r.bySeverity))
      increment(counts.needs_review_by_severity, sev, n);
  }
  return counts;
}

interface CodeAnalysisCounts {
  // null when meta.count is missing or malformed; never substitute features.length.
  count: number | null;
  instances: number;
  by_feature: Record<string, number>;
  application_support: Record<string, unknown>;
  inbox_provider_support: Record<string, unknown>;
  market_support: Record<string, unknown>;
}

// meta.count is the canonical total (feature count); meta.*_support pass through
// verbatim. instances/by_feature are derived from items.features for drill-down.
// A missing/malformed meta.count is reported as null (a data gap), not invented
// from features.length.
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

  const count = typeof meta.count === "number" && Number.isFinite(meta.count) ? meta.count : null;

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

// --- Create request ---

export interface PreviewCreateInput {
  subject: string;
  html: string;
  clients?: readonly string[];
  // Undefined defaults to all four; an empty array means "no checks".
  contentChecks?: readonly CheckName[];
  referenceId?: string;
}

// Body for POST /v2/preview/tests. HTML-only source; content_checking sends
// explicit booleans for all four; clients/reference_id omitted when absent.
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

// --- Output builder ---

export interface BuildOutputParams {
  testId: string;
  render: unknown;
  refs: Record<CheckName, CheckReference>;
  fetches: Record<CheckName, CheckFetch>;
  timedOut: boolean;
  warnings?: PreviewWarning[];
  // Explicit clients requested at create time. When provided, a requested client
  // absent from every render array becomes a data gap instead of disappearing.
  // The resume tool cannot recover this from the status API, so it is omitted.
  requestedClients?: readonly string[];
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
      impact:
        "Per-client completion status becomes available once the preview finishes processing.",
    });
  } else if (renderState.processing.length > 0) {
    // Slow/stuck client renders don't block results; report as a non-fatal gap (like the Inspect UI).
    dataGaps.push({
      code: "render_incomplete",
      product: PRODUCT,
      message: `${renderState.processing.length} client render(s) had not finished when results were returned.`,
      impact:
        "Screenshot rendering for some clients is still processing; content checks are unaffected. Resume with the same test id to collect the remaining renders.",
    });
  }

  // A requested client that never appears in any render array is a data gap, not
  // a silent omission.
  if (params.requestedClients) {
    const present = new Set([
      ...renderState.completed,
      ...renderState.processing,
      ...renderState.bounced,
    ]);
    const missing = params.requestedClients.filter((client) => !present.has(client));
    if (missing.length > 0) {
      dataGaps.push({
        code: "requested_client_missing",
        product: PRODUCT,
        message: `${missing.length} requested client(s) did not appear in any render state: ${missing.join(", ")}.`,
        impact:
          "Per-client render results for these clients are unavailable; they may be unsupported or still initializing.",
      });
    }
  }

  const lifecycleFor = (name: CheckName): CheckLifecycle =>
    normalizeCheckLifecycle(refs[name], fetches[name]);

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

  // meta.count is the canonical code-analysis total; a completed check that omits
  // it is a data gap rather than a fabricated count.
  if (codeLifecycle === "complete" && codeCounts.count === null) {
    dataGaps.push({
      code: "code_analysis_count_unavailable",
      product: PRODUCT,
      message: "The code analysis result did not include a usable meta.count total.",
      impact:
        "The code-analysis feature count is unavailable; per-feature instance counts are still reported.",
    });
  }

  if (timedOut) {
    dataGaps.push({
      code: "workflow_timed_out",
      product: PRODUCT,
      message: "The workflow deadline was reached while work was still processing.",
      impact: "Some render or check results may be incomplete; resume with the same test id.",
    });
  }

  // Cross-check aggregates fold link/image/accessibility failures only; code
  // analysis is reported separately.
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

  const totalIssues = linkCounts.failures + imageCounts.failures + a11yCounts.failures;

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
        count: codeCounts.count ?? 0,
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
  // Validated create-time check selection, threaded so an absent content_checking
  // property can be told apart from a not-requested one. Omitted by the resume tool.
  requestedChecks?: ReadonlySet<CheckName>;
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

// Fetch referenced check results concurrently (at most four). Unreferenced or
// errored checks are left unfetched.
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
        // An unexpected 404 is incomplete-but-successful evidence (unavailable +
        // data gap). Every other failure (401/403/429/5xx/network) is a real tool
        // error: propagate it and never retry.
        if (isNotFound(error)) {
          fetches[name] = { status: "not_found" };
        } else {
          throw error;
        }
      }
    }),
  );
  return fetches;
}

// Poll until every requested check is terminal or the deadline passes. Completion
// is driven by checks, not per-client rendering (a slow client never blocks).
// GETs only; creation happens outside this function.
export async function pollEmailPreviewQa(params: PollParams, deps: PollDeps): Promise<PollResult> {
  // The V2 poll interval is a fixed five seconds; the injected clock/sleep keep
  // tests deterministic without exposing a configurable interval.
  const deadline = deps.now() + params.timeoutMs;
  const statusPath = `/v2/preview/tests/${encodeURIComponent(params.testId)}`;

  let render: unknown = await deps.request("GET", statusPath);
  let refs = extractCheckResultIds(render, params.requestedChecks);
  let fetches = await fetchCheckResults(refs, deps);
  let timedOut = false;

  const allChecksTerminal = (): boolean =>
    CHECK_NAMES.every((name) => isCheckTerminal(refs[name], fetches[name]));

  while (!allChecksTerminal()) {
    if (deps.now() + POLL_INTERVAL_MS > deadline) {
      timedOut = true;
      break;
    }
    await deps.sleep(POLL_INTERVAL_MS);
    render = await deps.request("GET", statusPath);
    refs = extractCheckResultIds(render, params.requestedChecks);
    fetches = await fetchCheckResults(refs, deps);
  }

  return { render, refs, fetches, timedOut };
}
