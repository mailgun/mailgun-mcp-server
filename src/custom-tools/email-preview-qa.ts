// --- Vocabulary ---

export type RenderStatus = "complete" | "processing" | "partial" | "unknown";

export type CheckLifecycle =
  | "not_requested"
  | "processing"
  | "complete"
  | "job_failed"
  | "unavailable";

export const CHECK_NAMES = [
  "link_validation",
  "image_validation",
  "accessibility",
  "code_analysis",
] as const;

export type CheckName = (typeof CHECK_NAMES)[number];

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

// Normalize lifecycle status only for comparison, never for display.
function statusToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// Preserve upstream severity spelling and casing; bucket blank values as "unknown".
function severityBucket(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : "unknown";
}

function increment(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

// --- Render state ---

interface RenderState {
  status: RenderStatus;
  completed: string[];
  processing: string[];
  bounced: string[];
}

function normalizeRenderState(render: unknown): RenderState {
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

interface CheckReference {
  requested: boolean;
  // Exposed distinguishes a terminal empty node from an absent check that is still pending.
  exposed: boolean;
  hasErrors: boolean;
  resultId: string | null;
}

// Null means unrequested; absent checks without create-time selection remain pending.
function extractCheckResultIds(
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
function checkResultPath(name: CheckName, resultId: string): string {
  return `${CHECK_ADAPTERS[name].resultPath}/${encodeURIComponent(resultId)}`;
}

// --- Check fetch outcome ---

type CheckFetchStatus = "ok" | "not_found" | "not_fetched";

interface CheckFetch {
  status: CheckFetchStatus;
  payload?: unknown;
}

// Completion signal from the detail payload's meta.status (case-insensitive; missing = complete).
function detailStatus(payload: unknown): "complete" | "processing" {
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

// Check completion depends on its job and detail endpoint, not client rendering.
function isCheckTerminal(ref: CheckReference, fetch: CheckFetch): boolean {
  if (!ref.requested) return true;
  if (ref.hasErrors) return true;
  if (ref.resultId !== null) {
    if (fetch.status === "ok") return detailStatus(fetch.payload) !== "processing";
    if (fetch.status === "not_found") return true;
    return false; // not_fetched
  }
  // An exposed empty node is unavailable; an absent requested node is still pending.
  return ref.exposed;
}

// Lifecycle combines reference state with the detail fetch outcome.
function normalizeCheckLifecycle(ref: CheckReference, fetch: CheckFetch): CheckLifecycle {
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

function countLinkValidationIssues(payload: unknown): LinkImageCounts {
  const results = asArray(asRecord(asRecord(payload).items).results);
  return countFindingBuckets(results);
}

function countImageValidationIssues(payload: unknown): LinkImageCounts {
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

// Headline counts use instances; a rule without instances counts once.
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

function countAccessibilityIssues(payload: unknown): AccessibilityCounts {
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

// meta.count is canonical; missing values create a gap while support and feature detail pass through.
function countCodeAnalysisIssues(payload: unknown): CodeAnalysisCounts {
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

// --- Structured-check adapters ---

type CheckOutputByName = EmailPreviewQaOutput["checks"];
type CheckDetailsByName = {
  [K in CheckName]: Omit<CheckOutputByName[K], "status" | "result_id">;
};

interface IssueContribution {
  failures: number;
  bySeverity: Record<string, number>;
}

interface CheckInterpretation<K extends CheckName> {
  details: CheckDetailsByName[K];
  dataGaps?: DataGap[];
}

interface CheckAdapter<K extends CheckName> {
  resultPath: string;
  empty: () => CheckDetailsByName[K];
  interpret: (payload: unknown) => CheckInterpretation<K>;
  issues: (details: CheckDetailsByName[K]) => IssueContribution | null;
}

const emptyLinkImage = (): CheckDetailsByName["link_validation"] => ({
  passes: 0,
  failures: 0,
  informational: 0,
  by_severity: {},
});

const CHECK_ADAPTERS: { [K in CheckName]: CheckAdapter<K> } = {
  link_validation: {
    resultPath: "/v1/inspect/links",
    empty: emptyLinkImage,
    interpret: (payload) => ({ details: countLinkValidationIssues(payload) }),
    issues: (details) => ({ failures: details.failures, bySeverity: details.by_severity }),
  },
  image_validation: {
    resultPath: "/v1/inspect/images",
    empty: emptyLinkImage,
    interpret: (payload) => ({ details: countImageValidationIssues(payload) }),
    issues: (details) => ({ failures: details.failures, bySeverity: details.by_severity }),
  },
  accessibility: {
    resultPath: "/v1/inspect/accessibility",
    empty: () => ({
      failures: 0,
      failure_rules: 0,
      needs_review: 0,
      needs_review_rules: 0,
      failures_by_severity: {},
      needs_review_by_severity: {},
    }),
    interpret: (payload) => ({ details: countAccessibilityIssues(payload) }),
    issues: (details) => ({
      failures: details.failures,
      bySeverity: details.failures_by_severity,
    }),
  },
  code_analysis: {
    resultPath: "/v1/inspect/analyze",
    empty: () => ({
      count: 0,
      instances: 0,
      by_feature: {},
      application_support: {},
      inbox_provider_support: {},
      market_support: {},
    }),
    interpret: (payload) => {
      const counts = countCodeAnalysisIssues(payload);
      return {
        details: { ...counts, count: counts.count ?? 0 },
        dataGaps:
          counts.count === null
            ? [
                {
                  code: "code_analysis_count_unavailable",
                  product: PRODUCT,
                  message: "The code analysis result did not include a usable meta.count total.",
                  impact:
                    "The code-analysis feature count is unavailable; per-feature instance counts are still reported.",
                },
              ]
            : undefined,
      };
    },
    issues: () => null,
  },
};

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

// Send explicit check booleans; omit absent clients and reference_id.
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

interface BuildOutputParams {
  testId: string;
  render: unknown;
  refs: Record<CheckName, CheckReference>;
  fetches: Record<CheckName, CheckFetch>;
  timedOut: boolean;
  warnings?: PreviewWarning[];
  // Create-time clients reveal missing renders; resume cannot recover this provenance.
  requestedClients?: readonly string[];
}

interface NormalizedCheck<K extends CheckName> {
  output: CheckOutputByName[K];
  issues: IssueContribution | null;
  dataGaps: DataGap[];
}

type NormalizedChecks = { [K in CheckName]: NormalizedCheck<K> };

function normalizeStructuredCheck<K extends CheckName>(
  name: K,
  ref: CheckReference,
  fetch: CheckFetch,
): NormalizedCheck<K> {
  const lifecycle = normalizeCheckLifecycle(ref, fetch);
  const adapter = CHECK_ADAPTERS[name] as CheckAdapter<K>;
  const interpreted =
    lifecycle === "complete"
      ? adapter.interpret(fetch.payload)
      : { details: adapter.empty(), dataGaps: undefined };
  const dataGaps = [...(interpreted.dataGaps ?? [])];

  if (lifecycle === "unavailable" && ref.requested) {
    dataGaps.push(
      ref.resultId === null
        ? {
            code: "check_reference_missing",
            product: PRODUCT,
            message: `The ${name} check did not expose a result reference.`,
            impact: `Detailed ${name} results cannot be retrieved for this test.`,
          }
        : {
            code: "result_endpoint_unavailable",
            product: PRODUCT,
            message: `The ${name} result endpoint was unavailable.`,
            impact: `Detailed ${name} results could not be retrieved and are not counted.`,
          },
    );
  }

  return {
    output: {
      status: lifecycle,
      result_id: ref.resultId,
      ...interpreted.details,
    } as CheckOutputByName[K],
    issues: lifecycle === "complete" ? adapter.issues(interpreted.details) : null,
    dataGaps,
  };
}

function normalizeStructuredChecks(
  refs: Record<CheckName, CheckReference>,
  fetches: Record<CheckName, CheckFetch>,
): NormalizedChecks {
  return Object.fromEntries(
    CHECK_NAMES.map((name) => [name, normalizeStructuredCheck(name, refs[name], fetches[name])]),
  ) as NormalizedChecks;
}

function buildEmailPreviewQaOutput(params: BuildOutputParams): EmailPreviewQaOutput {
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

  // Report requested clients missing from every render state.
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

  const normalizedChecks = normalizeStructuredChecks(refs, fetches);
  dataGaps.push(...CHECK_NAMES.flatMap((name) => normalizedChecks[name].dataGaps));

  if (timedOut) {
    dataGaps.push({
      code: "workflow_timed_out",
      product: PRODUCT,
      message: "The workflow deadline was reached while work was still processing.",
      impact: "Some render or check results may be incomplete; resume with the same test id.",
    });
  }

  // Aggregate link, image, and accessibility failures; report code analysis separately.
  const byCheck: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byCheckAndSeverity: Record<string, Record<string, number>> = {};

  let totalIssues = 0;
  for (const name of CHECK_NAMES) {
    const contribution = normalizedChecks[name].issues;
    if (contribution === null) continue;
    totalIssues += contribution.failures;
    if (contribution.failures > 0) byCheck[name] = contribution.failures;
    for (const [sev, count] of Object.entries(contribution.bySeverity)) {
      increment(bySeverity, sev, count);
      byCheckAndSeverity[name] = byCheckAndSeverity[name] ?? {};
      increment(byCheckAndSeverity[name], sev, count);
    }
  }

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
      link_validation: normalizedChecks.link_validation.output,
      image_validation: normalizedChecks.image_validation.output,
      accessibility: normalizedChecks.accessibility.output,
      code_analysis: normalizedChecks.code_analysis.output,
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

interface PollParams {
  testId: string;
  timeoutMs: number;
  // Create-time selection distinguishes absent pending checks from unrequested checks.
  requestedChecks?: ReadonlySet<CheckName>;
}

interface PollResult {
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

// Fetch at most four referenced check results concurrently.
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
        // A detail 404 becomes a data gap; all other failures propagate without retry.
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

// Poll requested checks to a terminal state or deadline; client rendering never blocks.
async function pollEmailPreviewQa(params: PollParams, deps: PollDeps): Promise<PollResult> {
  // Fixed five-second polling stays deterministic through injected time dependencies.
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

export interface CollectEmailPreviewQaParams extends PollParams {
  warnings?: PreviewWarning[];
  requestedClients?: readonly string[];
}

// Distinguish polling failures after creation from local normalization failures.
export class EmailPreviewQaPollError extends Error {
  constructor(public readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "EmailPreviewQaPollError";
  }
}

// Callers provide provenance and receive a final summary; collection details stay internal.
export async function collectEmailPreviewQa(
  params: CollectEmailPreviewQaParams,
  deps: PollDeps,
): Promise<EmailPreviewQaOutput> {
  let poll: PollResult;
  try {
    poll = await pollEmailPreviewQa(params, deps);
  } catch (error) {
    throw new EmailPreviewQaPollError(error);
  }
  return buildEmailPreviewQaOutput({
    testId: params.testId,
    render: poll.render,
    refs: poll.refs,
    fetches: poll.fetches,
    timedOut: poll.timedOut,
    warnings: params.warnings,
    requestedClients: params.requestedClients,
  });
}
