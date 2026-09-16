import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MailgunApiError, makeMailgunRequest } from "../src/api.js";
import { USER_AGENT } from "../src/version.js";

class FakeClientRequest extends EventEmitter {
  write(): void {}
  end(): void {}
}

const hoisted = vi.hoisted(() => ({
  lastOptions: null as RequestOptions | null,
}));

vi.mock("node:https", () => ({
  default: {
    request: (options: RequestOptions, cb: (res: EventEmitter) => void) => {
      hoisted.lastOptions = options;
      const req = new FakeClientRequest();
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = 200;
      cb(res);
      res.emit("data", Buffer.from(JSON.stringify({ ok: true })));
      res.emit("end");
      return req;
    },
  },
}));

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

describe("makeMailgunRequest user agent", () => {
  afterEach(() => {
    hoisted.lastOptions = null;
  });

  test("sends the Mailgun MCP user agent on every request", async () => {
    await expect(makeMailgunRequest("GET", "/v3/domains")).resolves.toEqual({ ok: true });
    expect(hoisted.lastOptions?.headers?.["User-Agent"]).toBe(USER_AGENT);
  });
});
