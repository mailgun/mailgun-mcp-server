import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { MailgunApiError, makeMailgunRequest } from "../src/api.js";

describe("MailgunApiError", () => {
  test("carries statusCode and apiMessage", () => {
    const err = new MailgunApiError("forbidden", 403, "Plan upgrade required");
    expect(err.statusCode).toBe(403);
    expect(err.apiMessage).toBe("Plan upgrade required");
    expect(err.message).toBe("forbidden");
    expect(err.name).toBe("MailgunApiError");
    expect(err).toBeInstanceOf(Error);
  });

  test("works without apiMessage", () => {
    const err = new MailgunApiError("parse error", 500);
    expect(err.statusCode).toBe(500);
    expect(err.apiMessage).toBeUndefined();
  });
});

// A fake https.request so the request/response lifecycle can be driven from tests
// without real sockets. destroy(err) mirrors Node: it surfaces on the 'error' event.
class FakeClientRequest extends EventEmitter {
  destroyed = false;
  write(): void {}
  end(): void {}
  destroy(error?: Error): void {
    this.destroyed = true;
    if (error) this.emit("error", error);
  }
}

const hoisted = vi.hoisted(() => ({
  pending: null as { req: FakeClientRequest; cb: (res: EventEmitter) => void } | null,
}));

vi.mock("node:https", () => ({
  default: {
    request: (_options: unknown, cb: (res: EventEmitter) => void) => {
      const req = new FakeClientRequest();
      hoisted.pending = { req, cb };
      return req;
    },
  },
}));

function respond(statusCode: number, body: unknown): void {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  hoisted.pending!.cb(res);
  res.emit("data", Buffer.from(JSON.stringify(body)));
  res.emit("end");
}

describe("makeMailgunRequest per-request timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hoisted.pending = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test("aborts absolutely when the response never completes", async () => {
    // Attach the catch synchronously so the later rejection is always handled.
    const settled = makeMailgunRequest(
      "GET",
      "/v2/preview/tests/x",
      null,
      "application/json",
      30_000,
    ).catch((error: unknown) => error);
    // Deadline is absolute: it fires even though the connection is "active".
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await settled).toMatchObject({
      name: "MailgunApiError",
      statusCode: 0,
      message: /timed out after 30000ms/,
    });
    expect(hoisted.pending?.req.destroyed).toBe(true);
  });

  test("a completed response clears the timer and resolves (no late abort)", async () => {
    const promise = makeMailgunRequest(
      "GET",
      "/v2/preview/tests/x",
      null,
      "application/json",
      30_000,
    );
    respond(200, { id: "preview_test_001" });
    await expect(promise).resolves.toEqual({ id: "preview_test_001" });
    // Advancing past the old deadline must not destroy the settled request.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hoisted.pending?.req.destroyed).toBe(false);
  });

  test("compatibility: an omitted timeout arms no timer and still resolves", async () => {
    const promise = makeMailgunRequest("GET", "/v2/preview/tests/x");
    respond(200, { ok: true });
    await expect(promise).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(hoisted.pending?.req.destroyed).toBe(false);
  });
});
