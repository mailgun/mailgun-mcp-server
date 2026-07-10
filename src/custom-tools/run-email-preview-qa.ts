import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeMailgunRequest, MailgunApiError } from "../api.js";
import { META_TAGS_KEY, type Tag } from "../tags.js";
import {
  buildEmailPreviewQaOutput,
  buildPreviewCreateRequest,
  extractCreatedTestId,
  normalizeWarnings,
  pollEmailPreviewQa,
  CHECK_NAMES,
  type CheckName,
  type EmailPreviewQaOutput,
  type PollDeps,
  type RequestFn,
} from "./email-preview-qa.js";

// run_email_preview_qa is the CREATE / poll composite — the one write in the
// Email Preview QA surface. It validates input, issues exactly ONE
// POST /v2/preview/tests, then reuses the shared read/poll/build path. It never
// retries the create (V2 creation is not idempotent) and never issues a second
// POST on timeout or ambiguity.

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 300;
const PER_REQUEST_TIMEOUT_MS = 30_000;
const CREATE_PATH = "/v2/preview/tests";

export interface RunEmailPreviewQaInput {
  subject: string;
  html: string;
  clients?: string[];
  contentChecks?: CheckName[];
  referenceId?: string;
  timeoutSeconds?: number;
}

export interface ValidatedRunInput {
  subject: string;
  html: string;
  clients?: string[];
  contentChecks: CheckName[];
  referenceId?: string;
  timeoutSeconds: number;
}

// Structured error surfaced by the composite. `retryable` refers to re-invoking
// the tool; it never implies the composite itself should silently re-POST.
export class RunEmailPreviewQaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly details: string,
    public readonly testId?: string,
    public readonly referenceId?: string,
  ) {
    super(message);
    this.name = "RunEmailPreviewQaError";
  }
}

function clampTimeoutSeconds(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return DEFAULT_TIMEOUT_SECONDS;
  if (value < 0) return 0;
  if (value > MAX_TIMEOUT_SECONDS) return MAX_TIMEOUT_SECONDS;
  return value;
}

// Pure validation. Throws RunEmailPreviewQaError with an INVALID_* code before
// any network work happens.
export function validateRunInput(raw: RunEmailPreviewQaInput): ValidatedRunInput {
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  if (subject === "") {
    throw new RunEmailPreviewQaError(
      "INVALID_SUBJECT",
      "A non-empty subject is required to create an email preview test.",
      false,
      "The 'subject' parameter was empty or missing.",
    );
  }

  const html = typeof raw.html === "string" ? raw.html : "";
  if (html.trim() === "") {
    throw new RunEmailPreviewQaError(
      "INVALID_HTML",
      "Non-empty HTML content is required to create an email preview test.",
      false,
      "The 'html' parameter was empty or missing. HTML is the only supported source.",
    );
  }

  let clients: string[] | undefined;
  if (raw.clients !== undefined) {
    if (!Array.isArray(raw.clients) || raw.clients.length === 0) {
      throw new RunEmailPreviewQaError(
        "INVALID_CLIENTS",
        "The clients list, when provided, must contain at least one client id.",
        false,
        "An empty clients array was provided; omit clients entirely to use the Mailgun default set.",
      );
    }
    // Dedupe while preserving order.
    clients = [...new Set(raw.clients.filter((c) => typeof c === "string" && c.trim() !== ""))];
    if (clients.length === 0) {
      throw new RunEmailPreviewQaError(
        "INVALID_CLIENTS",
        "The clients list did not contain any valid client ids.",
        false,
        "All provided client ids were blank.",
      );
    }
  }

  // contentChecks: default all four; empty array is valid and means "no checks".
  const contentChecks =
    raw.contentChecks === undefined ? [...CHECK_NAMES] : [...new Set(raw.contentChecks)];

  const referenceId =
    typeof raw.referenceId === "string" && raw.referenceId.trim() !== ""
      ? raw.referenceId.trim()
      : undefined;

  return {
    subject,
    html,
    clients,
    contentChecks,
    referenceId,
    timeoutSeconds: clampTimeoutSeconds(raw.timeoutSeconds),
  };
}

// A definitive API error means Mailgun responded (4xx/5xx). Anything else — a
// timeout (statusCode 0) or a transport error — is ambiguous: the POST may have
// reached Mailgun, so we must not retry it.
function isDefinitiveApiError(error: unknown): error is MailgunApiError {
  return error instanceof MailgunApiError && error.statusCode >= 400;
}

// Core workflow with I/O injected. Exported for deterministic tests.
export async function runCreateAndPoll(
  input: ValidatedRunInput,
  deps: PollDeps,
): Promise<EmailPreviewQaOutput> {
  const body = buildPreviewCreateRequest(input);

  let created: unknown;
  try {
    created = await deps.request("POST", CREATE_PATH, body);
  } catch (error) {
    if (isDefinitiveApiError(error)) {
      const code = error.statusCode === 403 ? "NOT_ENTITLED" : "CREATE_REJECTED";
      throw new RunEmailPreviewQaError(
        code,
        error.statusCode === 403
          ? "Email Preview is not enabled for this account, or creation was forbidden."
          : "Mailgun rejected the email preview test creation request.",
        error.statusCode >= 500 || error.statusCode === 429,
        `POST ${CREATE_PATH} returned ${error.statusCode}: ${error.apiMessage ?? error.message}`,
        undefined,
        input.referenceId,
      );
    }
    // Ambiguous: the create may have reached Mailgun before the failure.
    throw new RunEmailPreviewQaError(
      "AMBIGUOUS_CREATE",
      "The create request failed after it may have reached Mailgun. A preview test may have been created; a second create was NOT attempted.",
      true,
      `POST ${CREATE_PATH} failed without a definitive response: ${error instanceof Error ? error.message : String(error)}. Reconcile with list_preview_tests${input.referenceId ? ` using reference_id '${input.referenceId}'` : ""} before creating another test.`,
      undefined,
      input.referenceId,
    );
  }

  const testId = extractCreatedTestId(created);
  if (testId === null) {
    // The create call succeeded at the transport level but returned no id. Treat
    // as a runtime error; never poll and never re-POST.
    throw new RunEmailPreviewQaError(
      "CREATE_NO_TEST_ID",
      "The create response did not include a test id.",
      false,
      `POST ${CREATE_PATH} returned a success response without an 'id'. Reconcile with list_preview_tests${input.referenceId ? ` using reference_id '${input.referenceId}'` : ""} before creating another test.`,
      undefined,
      input.referenceId,
    );
  }

  const warnings = normalizeWarnings(created);

  let poll;
  try {
    poll = await pollEmailPreviewQa({ testId, timeoutMs: input.timeoutSeconds * 1000 }, deps);
  } catch (error) {
    // The test WAS created; a polling failure must not trigger a re-create.
    throw new RunEmailPreviewQaError(
      "POLL_FAILED_AFTER_CREATE",
      "The preview test was created, but retrieving its status failed.",
      true,
      `Test '${testId}' was created. Resume with get_email_preview_qa (test_id '${testId}') rather than creating another test. Cause: ${error instanceof Error ? error.message : String(error)}`,
      testId,
      input.referenceId,
    );
  }

  return buildEmailPreviewQaOutput({
    testId,
    render: poll.render,
    refs: poll.refs,
    fetches: poll.fetches,
    timedOut: poll.timedOut,
    warnings,
  });
}

function defaultDeps(): PollDeps {
  const request: RequestFn = (method, path, body) =>
    makeMailgunRequest(
      method,
      path,
      (body as Record<string, unknown> | undefined) ?? null,
      "application/json",
      PER_REQUEST_TIMEOUT_MS,
    );
  return {
    request,
    now: () => Date.now(),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function register(server: McpServer, tags: readonly Tag[] = []): void {
  server.registerTool(
    "run_email_preview_qa",
    {
      description:
        "Create and summarize an email preview QA test from HTML. This CREATES one remote Mailgun Inspect preview test and CONSUMES preview quota; it does NOT send email. It issues exactly one create request, polls the render/checks until they settle or the timeout is reached, and returns mechanical counts and result references — never a pass/fail verdict or raw email content. V2 creation is not idempotent and this tool never auto-retries the create: on a timeout it returns partial results with timed_out=true (resume with get_email_preview_qa), and on an ambiguous failure it reports that a test may have been created and recommends list_preview_tests rather than creating another.",
      inputSchema: {
        subject: z.string().describe("Subject line for the preview test (required)."),
        html: z.string().describe("Rendered HTML email content to test (required; the only supported source)."),
        clients: z
          .array(z.string())
          .optional()
          .describe("Optional explicit client ids (from list_preview_clients). Omit to use Mailgun defaults; an empty list is rejected."),
        content_checks: z
          .array(z.enum(["link_validation", "image_validation", "accessibility", "code_analysis"]))
          .optional()
          .describe("Which structured checks to run. Defaults to all four; an empty list runs no checks."),
        reference_id: z
          .string()
          .optional()
          .describe("Optional caller-supplied id echoed back and useful for reconciling an ambiguous create via list_preview_tests."),
        timeout_seconds: z
          .number()
          .optional()
          .describe(
            `How long to poll for the render/checks to settle, in seconds (0-${MAX_TIMEOUT_SECONDS}, default ${DEFAULT_TIMEOUT_SECONDS}). On timeout the partial summary is returned with timed_out=true; resume with get_email_preview_qa.`,
          ),
      },
      _meta: { [META_TAGS_KEY]: [...tags] },
    },
    async (params) => {
      try {
        const validated = validateRunInput({
          subject: params.subject,
          html: params.html,
          clients: params.clients,
          contentChecks: params.content_checks,
          referenceId: params.reference_id,
          timeoutSeconds: params.timeout_seconds,
        });
        const output = await runCreateAndPoll(validated, defaultDeps());
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
        if (error instanceof RunEmailPreviewQaError) {
          const payload = {
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              details: error.details,
              ...(error.testId ? { test_id: error.testId } : {}),
              ...(error.referenceId ? { reference_id: error.referenceId } : {}),
            },
          };
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          };
        }
        const payload = {
          error: {
            code: "UPSTREAM_API_ERROR",
            message: "Unable to create the email preview QA test.",
            retryable: true,
            details: error instanceof Error ? error.message : String(error),
          },
        };
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      }
    },
  );
}
