import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MailgunApiError } from "../api.js";
import { META_TAGS_KEY, type Tag } from "../tags.js";
import {
  buildEmailPreviewQaOutput,
  pollEmailPreviewQa,
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

// The READ/RESUME composite: polls an existing test id, fetches the referenced
// check results, and returns the same summary. Never creates a test.
//
// Limitation: the status API does not report which content checks or clients were
// requested at create time. This tool therefore cannot flag a not-requested check
// as "not_requested" from an absent property (it treats an absent content_checking
// property as still-pending, never terminating after a single read), and it cannot
// emit a requested_client_missing data gap. Explicit null checks are still reported
// as not_requested. Use run_email_preview_qa when that provenance matters.

export interface GetEmailPreviewQaParams {
  testId: string;
  timeoutSeconds?: number;
}

export interface GetEmailPreviewQaError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: string;
  };
}

// Core workflow with I/O injected. Exported for deterministic tests. Throws
// InvalidTimeoutError (before any request) when timeout_seconds is out of contract.
export async function runGetEmailPreviewQa(
  params: GetEmailPreviewQaParams,
  deps: PollDeps,
): Promise<EmailPreviewQaOutput> {
  const timeoutMs = resolveTimeoutSeconds(params.timeoutSeconds) * 1000;
  // No requestedChecks: the resume path cannot recover the create-time selection.
  const poll = await pollEmailPreviewQa({ testId: params.testId, timeoutMs }, deps);
  return buildEmailPreviewQaOutput({
    testId: params.testId,
    render: poll.render,
    refs: poll.refs,
    fetches: poll.fetches,
    timedOut: poll.timedOut,
  });
}

function buildErrorResponse(
  code: string,
  message: string,
  retryable: boolean,
  details: string,
): GetEmailPreviewQaError {
  return { error: { code, message, retryable, details } };
}

export function register(server: McpServer, tags: readonly Tag[] = []): void {
  server.registerTool(
    "get_email_preview_qa",
    {
      description:
        "Resume and summarize an existing email preview QA test. Polls the render status of a test id until it settles (or the timeout is reached), retrieves the requested structured-check results (links, images, accessibility, code analysis), and returns counts and result references. Does not create a test; use run_email_preview_qa to create one.",
      inputSchema: {
        test_id: z
          .string()
          .describe("The id of an existing email preview test to resume and summarize."),
        timeout_seconds: timeoutSecondsSchema.describe(
          `How long to poll for the render/checks to settle, in whole seconds (integer 0-${MAX_TIMEOUT_SECONDS}, default ${DEFAULT_TIMEOUT_SECONDS}). On timeout the partial summary is returned with timed_out=true; resume with the same test id.`,
        ),
      },
      _meta: { [META_TAGS_KEY]: [...tags] },
    },
    async (params) => {
      const testId = typeof params.test_id === "string" ? params.test_id.trim() : "";
      if (testId === "") {
        const err = buildErrorResponse(
          "INVALID_TEST_ID",
          "A test id is required to resume an email preview QA test.",
          false,
          "The 'test_id' parameter was empty or missing.",
        );
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
        };
      }

      try {
        const output = await runGetEmailPreviewQa(
          { testId, timeoutSeconds: params.timeout_seconds },
          createDefaultDeps(),
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
        if (error instanceof InvalidTimeoutError) {
          // Rejected before any request; nothing was polled.
          const err = buildErrorResponse(
            "INVALID_TIMEOUT",
            `timeout_seconds must be an integer between 0 and ${MAX_TIMEOUT_SECONDS}.`,
            false,
            error.detail,
          );
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
          };
        }
        const isApiError = error instanceof MailgunApiError;
        const statusCode = isApiError ? error.statusCode : 0;
        const retryable = statusCode >= 500 || statusCode === 429 || statusCode === 0;
        const code =
          statusCode === 404
            ? "TEST_NOT_FOUND"
            : statusCode === 403
              ? "NOT_ENTITLED"
              : "UPSTREAM_API_ERROR";
        const err = buildErrorResponse(
          code,
          statusCode === 404
            ? "No email preview test was found for the provided test id."
            : statusCode === 403
              ? "Email Preview is not enabled for this account, or the test is not accessible."
              : "Unable to retrieve the email preview QA status for this test.",
          retryable,
          isApiError
            ? `GET /v2/preview/tests/${testId} returned ${error.statusCode}: ${error.apiMessage ?? error.message}`
            : `Email preview QA workflow failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
        };
      }
    },
  );
}
