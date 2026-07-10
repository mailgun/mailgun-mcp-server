import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeMailgunRequest, MailgunApiError } from "../api.js";
import { META_TAGS_KEY, type Tag } from "../tags.js";
import {
  buildEmailPreviewQaOutput,
  pollEmailPreviewQa,
  type EmailPreviewQaOutput,
  type PollDeps,
  type RequestFn,
} from "./email-preview-qa.js";

// get_email_preview_qa is the READ / RESUME composite. It never creates a test.
// Given an existing test id, it polls the V2 render status until the render
// settles (or a deadline passes), fetches the referenced structured-check
// results, and returns the mechanical counts-and-references QA summary. Creation
// is handled only by the separate run_email_preview_qa composite.

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;
const PER_REQUEST_TIMEOUT_MS = 30_000;

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

function clampTimeoutSeconds(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return DEFAULT_TIMEOUT_SECONDS;
  if (value < 0) return 0;
  if (value > MAX_TIMEOUT_SECONDS) return MAX_TIMEOUT_SECONDS;
  return value;
}

// Core workflow with I/O injected. Exported for deterministic tests.
export async function runGetEmailPreviewQa(
  params: GetEmailPreviewQaParams,
  deps: PollDeps,
): Promise<EmailPreviewQaOutput> {
  const timeoutMs = clampTimeoutSeconds(params.timeoutSeconds) * 1000;
  const poll = await pollEmailPreviewQa({ testId: params.testId, timeoutMs }, deps);
  return buildEmailPreviewQaOutput({
    testId: params.testId,
    render: poll.render,
    refs: poll.refs,
    fetches: poll.fetches,
    timedOut: poll.timedOut,
  });
}

function defaultDeps(): PollDeps {
  const request: RequestFn = (method, path) =>
    makeMailgunRequest(method, path, null, "application/json", PER_REQUEST_TIMEOUT_MS);
  return {
    request,
    now: () => Date.now(),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
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
        "Resume and summarize an existing email preview QA test. Polls the render status of a test id until it settles (or the timeout is reached), retrieves the requested structured-check results (links, images, accessibility, code analysis), and returns mechanical counts and result references — never a pass/fail verdict and never raw email content. Does not create a test; use run_email_preview_qa to create one.",
      inputSchema: {
        test_id: z.string().describe("The id of an existing email preview test to resume and summarize."),
        timeout_seconds: z
          .number()
          .optional()
          .describe(
            `How long to poll for the render/checks to settle, in seconds (0-${MAX_TIMEOUT_SECONDS}, default ${DEFAULT_TIMEOUT_SECONDS}). On timeout the partial summary is returned with timed_out=true; resume with the same test id.`,
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
          defaultDeps(),
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
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
