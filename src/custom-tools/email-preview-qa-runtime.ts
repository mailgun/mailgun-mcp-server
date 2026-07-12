import { performance } from "node:perf_hooks";
import { z } from "zod";
import { makeMailgunRequest } from "../api.js";
import type { PollDeps, RequestFn } from "./email-preview-qa.js";

// Runtime policy shared by the create and resume Email Preview QA tools.

export const DEFAULT_TIMEOUT_SECONDS = 120;
export const MAX_TIMEOUT_SECONDS = 300;
export const PER_REQUEST_TIMEOUT_MS = 30_000;

// Schema validation rejects invalid timeouts before network access.
export const timeoutSecondsSchema = z.number().int().min(0).max(MAX_TIMEOUT_SECONDS).optional();

export class InvalidTimeoutError extends Error {
  constructor(public readonly detail: string) {
    super("Invalid timeout_seconds value.");
    this.name = "InvalidTimeoutError";
  }
}

// Direct workflow callers receive the same validation and default as MCP callers.
export function resolveTimeoutSeconds(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_SECONDS;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_TIMEOUT_SECONDS
  ) {
    throw new InvalidTimeoutError(
      `timeout_seconds must be an integer between 0 and ${MAX_TIMEOUT_SECONDS}; received ${String(value)}.`,
    );
  }
  return value;
}

// Production polling uses per-request aborts and a monotonic clock; tests inject deterministic deps.
export function createDefaultDeps(): PollDeps {
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
    now: () => performance.now(),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
