import { performance } from "node:perf_hooks";
import { z } from "zod";
import { makeMailgunRequest } from "../api.js";
import type { PollDeps, RequestFn } from "./email-preview-qa.js";

// Runtime concerns shared by the two Email Preview QA composites (create/poll and
// resume): the MCP timeout contract, and the production I/O dependencies. Kept
// feature-local and deliberately small, with no generalized DI or adapter framework.

export const DEFAULT_TIMEOUT_SECONDS = 120;
export const MAX_TIMEOUT_SECONDS = 300;
export const PER_REQUEST_TIMEOUT_MS = 30_000;

// Shared MCP timeout contract: integer seconds, 0..300, default 120. Enforced at
// the schema level so invalid values are rejected before any network access.
export const timeoutSecondsSchema = z.number().int().min(0).max(MAX_TIMEOUT_SECONDS).optional();

export class InvalidTimeoutError extends Error {
  constructor(public readonly detail: string) {
    super("Invalid timeout_seconds value.");
    this.name = "InvalidTimeoutError";
  }
}

// Core-level guard mirroring `timeoutSecondsSchema` for the exported workflow
// functions (tests and internal callers use these directly). Applies the default,
// rejects fractional/negative/oversized values, and never silently coerces, so a
// rejected value makes zero requests.
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

// Production dependencies: a real Mailgun request adapter with an absolute
// per-request abort timeout, a MONOTONIC clock (performance.now, immune to
// wall-clock adjustments) for deadline math, and a real sleep. Tests inject their
// own deterministic PollDeps instead.
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
