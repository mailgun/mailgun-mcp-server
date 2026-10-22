import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { MailgunApiError, makeMailgunRequest } from "../../src/api.js";
import { WorkflowDeadlineError } from "../../src/custom-tools/email-preview-qa.js";
import {
  createDefaultDeps,
  HANDLER_DEADLINE_MS,
  PER_REQUEST_TIMEOUT_MS,
} from "../../src/custom-tools/email-preview-qa-runtime.js";

vi.mock("../../src/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api.js")>()),
  makeMailgunRequest: vi.fn<typeof makeMailgunRequest>(),
}));

const request = vi.mocked(makeMailgunRequest);
let clock = 0;

beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  request.mockReset();
  request.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function lastTimeoutMs(): number | undefined {
  return request.mock.calls.at(-1)?.[4];
}

describe("createDefaultDeps", () => {
  test("uses the per-request timeout while the handler deadline is far away", async () => {
    const deps = createDefaultDeps();
    await deps.request("GET", "/v2/preview/tests/t");
    expect(lastTimeoutMs()).toBe(PER_REQUEST_TIMEOUT_MS);
  });

  test("clamps a late request to the time left before the handler deadline", async () => {
    const deps = createDefaultDeps();
    clock = HANDLER_DEADLINE_MS - 4_000;
    await deps.request("GET", "/v2/preview/tests/t");
    expect(lastTimeoutMs()).toBe(4_000);
  });

  test("refuses to start a request once the handler deadline has passed", async () => {
    const deps = createDefaultDeps();
    clock = HANDLER_DEADLINE_MS;
    await expect(deps.request("GET", "/v2/preview/tests/t")).rejects.toBeInstanceOf(
      WorkflowDeadlineError,
    );
    expect(request).not.toHaveBeenCalled();
  });

  test("reports an abort at the handler deadline as a deadline error", async () => {
    const deps = createDefaultDeps();
    clock = HANDLER_DEADLINE_MS - 1_000;
    request.mockImplementation(async () => {
      clock = HANDLER_DEADLINE_MS;
      throw new MailgunApiError("Request timed out after 1000ms", 0);
    });
    await expect(deps.request("GET", "/v2/preview/tests/t")).rejects.toBeInstanceOf(
      WorkflowDeadlineError,
    );
  });

  test("passes other failures through unchanged", async () => {
    const deps = createDefaultDeps();
    const failure = new MailgunApiError("boom", 500);
    request.mockRejectedValue(failure);
    await expect(deps.request("GET", "/v2/preview/tests/t")).rejects.toBe(failure);
  });
});
