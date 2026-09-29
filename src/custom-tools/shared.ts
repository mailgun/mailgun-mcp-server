import { MailgunApiError } from "../api.js";

export interface ToolError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: string;
  };
}

export function errorResult(code: string, message: string, retryable: boolean, details: string) {
  const err: ToolError = { error: { code, message, retryable, details } };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
  };
}

export function upstreamErrorResult(error: unknown, endpoint: string, message: string) {
  const isApiError = error instanceof MailgunApiError;
  const statusCode = isApiError ? error.statusCode : 0;
  const retryable = statusCode >= 500 || statusCode === 429;

  return errorResult(
    "UPSTREAM_API_ERROR",
    message,
    retryable,
    isApiError
      ? `${endpoint} returned ${statusCode}: ${error.apiMessage ?? error.message}`
      : `${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
