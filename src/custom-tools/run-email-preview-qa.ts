import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MailgunApiError } from "../api.js";
import { META_TAGS_KEY, type Tag } from "../tags.js";
import {
  buildPreviewCreateRequest,
  collectEmailPreviewQa,
  EmailPreviewQaPollError,
  extractCreatedTestId,
  normalizeWarnings,
  CHECK_NAMES,
  type CheckName,
  type EmailPreviewQaOutput,
  type PollDeps,
} from "./email-preview-qa.js";
import {
  createDefaultDeps,
  DEFAULT_TIMEOUT_SECONDS,
  InvalidTimeoutError,
  MAX_TIMEOUT_SECONDS,
  resolveTimeoutSeconds,
  timeoutSecondsSchema,
} from "./email-preview-qa-runtime.js";

// Creates exactly one non-idempotent preview test, then collects its QA summary.

const CREATE_PATH = "/v2/preview/tests";

// Client-side UTF-8 limit, not a confirmed upstream Inspect maximum.
export const MAX_HTML_BYTES = 10 * 1024 * 1024; // 10 MiB

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

// Structured error; `retryable` refers to re-invoking the tool, never an auto re-POST.
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

// Validation raises INVALID_* errors before network work begins.
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

  const htmlBytes = Buffer.byteLength(html, "utf8");
  if (htmlBytes > MAX_HTML_BYTES) {
    throw new RunEmailPreviewQaError(
      "HTML_TOO_LARGE",
      "The HTML content exceeds the maximum size for an email preview test.",
      false,
      `The 'html' parameter is ${htmlBytes} UTF-8 bytes, over the ${MAX_HTML_BYTES}-byte (10 MiB) limit. This is an intentional client-side MCP input limit, not a confirmed upstream Inspect maximum.`,
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
    // Reject invalid clients; preserve valid ids exactly and deduplicate exact matches.
    for (const client of raw.clients) {
      if (typeof client !== "string" || client.trim() === "") {
        throw new RunEmailPreviewQaError(
          "INVALID_CLIENTS",
          "The clients list contained a blank or invalid client id.",
          false,
          "Every client id must be a non-empty string; omit clients entirely to use the Mailgun default set.",
        );
      }
    }
    clients = [...new Set(raw.clients)];
  }

  // contentChecks: default all four; empty array is valid and means "no checks".
  const contentChecks =
    raw.contentChecks === undefined ? [...CHECK_NAMES] : [...new Set(raw.contentChecks)];

  const referenceId =
    typeof raw.referenceId === "string" && raw.referenceId.trim() !== ""
      ? raw.referenceId.trim()
      : undefined;

  let timeoutSeconds: number;
  try {
    timeoutSeconds = resolveTimeoutSeconds(raw.timeoutSeconds);
  } catch (error) {
    if (error instanceof InvalidTimeoutError) {
      throw new RunEmailPreviewQaError(
        "INVALID_TIMEOUT",
        `timeout_seconds must be an integer between 0 and ${MAX_TIMEOUT_SECONDS}.`,
        false,
        error.detail,
      );
    }
    throw error;
  }

  return {
    subject,
    html,
    clients,
    contentChecks,
    referenceId,
    timeoutSeconds,
  };
}

// Only an upstream 4xx/5xx proves rejection; transport failures leave creation ambiguous.
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
      // Never re-POST after a definitive rejection; reconcile possible quota use by listing tests.
      throw new RunEmailPreviewQaError(
        code,
        error.statusCode === 403
          ? "Email Preview is not enabled for this account, or creation was forbidden."
          : "Mailgun rejected the email preview test creation request.",
        false,
        `POST ${CREATE_PATH} returned ${error.statusCode}: ${error.apiMessage ?? error.message}. Reconcile with list_preview_tests${input.referenceId ? ` using reference_id '${input.referenceId}'` : ""} before creating another test.`,
        undefined,
        input.referenceId,
      );
    }
    // The create may have arrived before transport failed, so reconcile instead of re-POSTing.
    throw new RunEmailPreviewQaError(
      "AMBIGUOUS_CREATE",
      "The create request failed after it may have reached Mailgun. A preview test may have been created; a second create was NOT attempted.",
      false,
      `POST ${CREATE_PATH} failed without a definitive response: ${error instanceof Error ? error.message : String(error)}. Reconcile with list_preview_tests${input.referenceId ? ` using reference_id '${input.referenceId}'` : ""} before creating another test.`,
      undefined,
      input.referenceId,
    );
  }

  const testId = extractCreatedTestId(created);
  if (testId === null) {
    // Success at transport level but no id: runtime error; never poll or re-POST.
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

  const requestedChecks = new Set(input.contentChecks);

  try {
    return await collectEmailPreviewQa(
      {
        testId,
        timeoutMs: input.timeoutSeconds * 1000,
        requestedChecks,
        warnings,
        requestedClients: input.clients,
      },
      deps,
    );
  } catch (error) {
    if (!(error instanceof EmailPreviewQaPollError)) throw error;
    const cause = error.cause;
    // Creation succeeded, so resume this test instead of re-POSTing.
    throw new RunEmailPreviewQaError(
      "POLL_FAILED_AFTER_CREATE",
      "The preview test was created, but retrieving its status failed.",
      false,
      `Test '${testId}' was created. Resume with get_email_preview_qa (test_id '${testId}') rather than creating another test. Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      testId,
      input.referenceId,
    );
  }
}

export function register(server: McpServer, tags: readonly Tag[] = []): void {
  server.registerTool(
    "run_email_preview_qa",
    {
      description:
        "Create and summarize an email preview QA test from HTML. This CREATES one remote Mailgun Inspect preview test and CONSUMES preview quota; it does NOT send email. It issues exactly one create request, polls the render/checks until they settle or the timeout is reached, and returns counts and result references. V2 creation is not idempotent and this tool never auto-retries the create: on a timeout it returns partial results with timed_out=true (resume with get_email_preview_qa), and on an ambiguous failure it reports that a test may have been created and recommends list_preview_tests rather than creating another.",
      inputSchema: {
        subject: z.string().describe("Subject line for the preview test (required)."),
        html: z
          .string()
          .describe("Rendered HTML email content to test (required; the only supported source)."),
        clients: z
          .array(z.string())
          .optional()
          .describe(
            "Optional explicit client ids (from list_preview_clients). Omit to use Mailgun defaults; an empty list is rejected.",
          ),
        content_checks: z
          .array(z.enum(CHECK_NAMES))
          .optional()
          .describe(
            "Which structured checks to run. Defaults to all four; an empty list runs no checks.",
          ),
        reference_id: z
          .string()
          .optional()
          .describe(
            "Optional caller-supplied id echoed back and useful for reconciling an ambiguous create via list_preview_tests.",
          ),
        timeout_seconds: timeoutSecondsSchema.describe(
          `How long to poll for the render/checks to settle, in whole seconds (integer 0-${MAX_TIMEOUT_SECONDS}, default ${DEFAULT_TIMEOUT_SECONDS}). On timeout the partial summary is returned with timed_out=true; resume with get_email_preview_qa.`,
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
        const output = await runCreateAndPoll(validated, createDefaultDeps());
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
