import { describe, test, expect, vi, beforeEach } from "vitest";
import { makeMailgunRequest, MailgunApiError } from "../../src/api.js";
import {
  buildInvestigationOutput,
  buildLogsRequestBody,
  buildLogsWindow,
  buildMessageReports,
  classify,
  register,
  type LogEvent,
} from "../../src/custom-tools/investigate-message-delivery.js";

vi.mock("../../src/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api.js")>()),
  makeMailgunRequest: vi.fn<typeof import("../../src/api.js").makeMailgunRequest>(),
}));

const mockRequest = vi.mocked(makeMailgunRequest);

const WINDOW = { start: "Mon, 28 Sep 2026 00:00:00 +0000", end: "Tue, 29 Sep 2026 00:00:00 +0000" };

function event(overrides: Partial<LogEvent> & { event: string }): LogEvent {
  return {
    id: "evt",
    "@timestamp": "2026-09-28T12:00:00.000Z",
    domain: { name: "tenant-a.example.com" },
    account: { id: "sub-123", "parent-id": "parent-1" },
    recipient: "alice@gmail.com",
    "recipient-provider": "Gmail",
    message: { headers: { "message-id": "abc@tenant-a.example.com", subject: "Your receipt" } },
    ...overrides,
  };
}

function registeredHandler() {
  const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
  register({ registerTool: mockRegisterTool } as never, ["send"]);
  return mockRegisterTool.mock.calls[0][2] as (
    p: Record<string, unknown>,
  ) => Promise<{ isError?: boolean; content: { text: string }[] }>;
}

describe("buildLogsWindow()", () => {
  const now = new Date("2026-09-29T12:00:00Z");

  test("defaults to a 72 hour lookback in RFC 2822", () => {
    expect(buildLogsWindow(undefined, now)).toEqual({
      start: "Sat, 26 Sep 2026 12:00:00 +0000",
      end: "Tue, 29 Sep 2026 12:00:00 +0000",
    });
  });

  test("uses lookback_hours", () => {
    expect(buildLogsWindow(2, now).start).toBe("Tue, 29 Sep 2026 10:00:00 +0000");
  });
});

describe("buildLogsRequestBody()", () => {
  test("filters on recipient and message id, newest first, across subaccounts", () => {
    const body = buildLogsRequestBody(
      { recipient: " alice@gmail.com ", message_id: "<xyz@d.com>" },
      WINDOW,
      "tok",
    );

    expect(body).toEqual({
      start: WINDOW.start,
      end: WINDOW.end,
      filter: {
        AND: [
          {
            attribute: "recipient",
            comparator: "=",
            values: [{ label: "alice@gmail.com", value: "alice@gmail.com" }],
          },
          {
            attribute: "message_id",
            comparator: "=",
            values: [{ label: "xyz@d.com", value: "xyz@d.com" }],
          },
        ],
      },
      include_subaccounts: true,
      include_totals: false,
      pagination: { sort: "timestamp:desc", limit: 100, token: "tok" },
    });
  });
});

describe("classify()", () => {
  const failed = (overrides: Partial<LogEvent>) =>
    event({ event: "failed", severity: "permanent", ...overrides });

  test.each([
    {
      name: "delivered after a temporary failure",
      events: [
        event({ event: "failed", severity: "temporary" }),
        event({ event: "delivered", "delivery-status": { message: "OK", "attempt-no": 2 } }),
      ],
      outcome: "delivered",
      detail: "Accepted by Gmail on attempt 2: OK",
    },
    {
      name: "delayed bounce after delivered",
      events: [
        event({ event: "delivered" }),
        failed({ flags: { "is-delayed-bounce": true }, "delivery-status": { code: 550 } }),
      ],
      outcome: "failed",
      detail: "then returned a bounce: code 550",
    },
    {
      name: "suppress-* reason",
      events: [failed({ reason: "suppress-bounce" })],
      outcome: "suppressed",
      detail: "suppress-bounce",
    },
    {
      name: "suppression code without reason",
      events: [failed({ "delivery-status": { code: 606 } })],
      outcome: "suppressed",
      detail: "code 606",
    },
    {
      name: "retries exhausted",
      events: [failed({ reason: "old", "delivery-status": { code: 421, message: "Too old" } })],
      outcome: "failed",
      detail: "Retried until the retry window closed, never accepted: code 421 Too old",
    },
    {
      name: "hard bounce",
      events: [
        failed({
          reason: "bounce",
          "delivery-status": { code: 550, "enhanced-code": "5.1.1", "bounce-type": "hard" },
        }),
      ],
      outcome: "failed",
      detail: "hard bounce from Gmail: code 550 5.1.1",
    },
    {
      name: "other permanent failure",
      events: [failed({ reason: "generic", "delivery-status": { code: 554, message: "policy" } })],
      outcome: "failed",
      detail: "code 554 policy",
    },
    {
      name: "temporary failure only",
      events: [
        event({ event: "accepted" }),
        event({
          event: "failed",
          severity: "temporary",
          "delivery-status": { code: 451, message: "greylisted" },
        }),
      ],
      outcome: "retrying",
      detail: "Last temporary failure: code 451 greylisted",
    },
    {
      name: "rejected",
      events: [
        event({ event: "rejected", reason: "Sandbox subdomains are for test purposes only" }),
      ],
      outcome: "rejected",
      detail: "Sandbox",
    },
    {
      name: "accepted only",
      events: [event({ event: "accepted" })],
      outcome: "accepted_pending",
      detail: "no delivery attempt",
    },
    {
      name: "unrecognized events",
      events: [event({ event: "opened" })],
      outcome: "unknown",
      detail: "Events seen: opened",
    },
  ])("$name → $outcome", ({ events, outcome, detail }) => {
    const result = classify(events);
    expect(result.outcome).toBe(outcome);
    expect(result.detail).toContain(detail);
  });
});

describe("buildMessageReports()", () => {
  test("groups by message id + recipient and sorts each timeline", () => {
    const reports = buildMessageReports([
      event({ event: "delivered", "@timestamp": "2026-09-28T12:02:00Z" }),
      event({ event: "accepted", "@timestamp": "2026-09-28T12:00:00Z" }),
      event({
        event: "failed",
        severity: "permanent",
        reason: "bounce",
        recipient: "bob@outlook.com",
        account: { id: "parent-1" },
        "@timestamp": "2026-09-28T12:01:00Z",
        "delivery-status": { code: 550, "bounce-type": "hard" },
      }),
    ]);

    expect(reports.map((r) => [r.recipient, r.outcome, r.subaccount_id])).toEqual([
      ["alice@gmail.com", "delivered", "sub-123"],
      ["bob@outlook.com", "failed", null],
    ]);
    expect(reports[0]).toMatchObject({
      message_id: "abc@tenant-a.example.com",
      sending_domain: "tenant-a.example.com",
      subject: "Your receipt",
    });
    expect(reports[0].timeline.map((t) => t.event)).toEqual(["accepted", "delivered"]);
  });

  test("events without a Message-Id share one group per recipient", () => {
    const reports = buildMessageReports([
      event({ id: "e1", event: "rejected", message: undefined }),
      event({ id: "e2", event: "rejected", message: undefined }),
    ]);

    expect(reports).toHaveLength(1);
    expect(reports[0].message_id).toBeNull();
  });
});

describe("buildInvestigationOutput()", () => {
  const output = (events: LogEvent[], truncated = false) =>
    buildInvestigationOutput({
      window: WINDOW,
      messages: buildMessageReports(events),
      suppressions: [],
      dataGaps: [],
      truncated,
    });

  test("single delivered message: summary mirrors it and adds the inbox-placement caveat", () => {
    const result = output([event({ event: "delivered" })]);

    expect(result.summary).toEqual({ outcome: "delivered", messages_found: 1, truncated: false });
    expect(result.notes.some((n) => n.includes("not proof of inbox placement"))).toBe(true);
  });

  test("no events: not_found_in_window with guidance", () => {
    const result = output([]);

    expect(result.summary.outcome).toBe("not_found_in_window");
    expect(result.notes.some((n) => n.includes("increase lookback_hours"))).toBe(true);
  });

  test("multiple messages and truncation", () => {
    const result = output(
      [
        event({ event: "accepted" }),
        event({ event: "accepted", message: { headers: { "message-id": "two@x.com" } } }),
      ],
      true,
    );

    expect(result.summary.outcome).toBe("multiple_messages");
    expect(result.data_gaps[0]).toContain("Stopped after the newest 500 events");
  });
});

describe("register()", () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  test('attaches _meta["com.mailgun/tags"] and registers under the expected name', () => {
    const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
    register({ registerTool: mockRegisterTool } as never, ["send"]);

    expect(mockRegisterTool.mock.calls[0][0]).toBe("investigate_message_delivery");
    const config = mockRegisterTool.mock.calls[0][1] as { _meta?: Record<string, unknown> };
    expect(config._meta).toEqual({ "com.mailgun/tags": ["send"] });
  });

  test("handler rejects a call with neither recipient nor message_id", async () => {
    const result = await registeredHandler()({});

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error.code).toBe("MISSING_IDENTIFIER");
  });

  test("checks suppressions on behalf of the subaccount and treats 404 as not listed", async () => {
    mockRequest.mockImplementation(async (method, path) => {
      if (method === "POST") return { items: [event({ event: "delivered" })] };
      if (path.includes("/bounces/")) return { address: "alice@gmail.com", code: "550" };
      if (path.includes("/complaints/")) throw new MailgunApiError("boom", 500, "boom");
      if (path.includes("/whitelists/")) {
        throw new MailgunApiError("not found", 404, "Address/Domain not found in allowlist table");
      }
      throw new MailgunApiError("not found", 404, "Address not found in unsubscribers table");
    });

    const output = JSON.parse(
      (await registeredHandler()({ recipient: "alice@gmail.com" })).content[0].text,
    );

    expect(mockRequest).toHaveBeenCalledWith(
      "GET",
      "/v3/tenant-a.example.com/bounces/alice%40gmail.com",
      null,
      undefined,
      { "X-Mailgun-On-Behalf-Of": "sub-123" },
    );
    expect(output.suppressions[0]).toMatchObject({
      bounce: { code: "550" },
      unsubscribe: null,
      complaint: null,
      allowlist: null,
    });
    expect(output.data_gaps).toHaveLength(1);
    expect(output.data_gaps[0]).toContain("/complaints/");
  });

  test("a 404 for an unknown domain is reported as a data gap", async () => {
    mockRequest.mockImplementation(async (method) => {
      if (method === "POST") return { items: [event({ event: "delivered" })] };
      throw new MailgunApiError("not found", 404, "domain not found");
    });

    const output = JSON.parse(
      (await registeredHandler()({ recipient: "alice@gmail.com" })).content[0].text,
    );

    expect(output.data_gaps).toHaveLength(4);
  });

  test("stops paging at the page cap and flags truncation", async () => {
    const page = Array.from({ length: 100 }, () => event({ event: "accepted" }));
    mockRequest.mockImplementation(async (method) =>
      method === "POST" ? { items: page, pagination: { next: "tok" } } : {},
    );

    const output = JSON.parse((await registeredHandler()({ message_id: "abc" })).content[0].text);

    expect(mockRequest.mock.calls.filter(([method]) => method === "POST")).toHaveLength(5);
    expect(output.summary.truncated).toBe(true);
  });

  test("returns a retryable upstream error when the logs query fails", async () => {
    mockRequest.mockRejectedValue(new MailgunApiError("busy", 503, "busy"));

    const result = await registeredHandler()({ recipient: "alice@gmail.com" });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatchObject({
      code: "UPSTREAM_API_ERROR",
      retryable: true,
    });
  });
});
