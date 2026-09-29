import { describe, test, expect, vi } from "vitest";
import {
	buildInvestigationOutput,
	buildLogsRequestBody,
	buildMessageReports,
	classify,
	normaliseMessageId,
	register,
	resolveWindow,
	suppressionPairs,
	toRfc2822,
	type LogEvent,
	type MessageReport,
	type SuppressionReport,
} from "../../src/custom-tools/investigate-message-delivery.js";
import { registerCustomTools } from "../../src/custom-tools/index.js";

const WINDOW = { start: "Mon, 28 Sep 2026 00:00:00 +0000", end: "Tue, 29 Sep 2026 00:00:00 +0000" };

function event(overrides: Partial<LogEvent> & { event: string }): LogEvent {
	return {
		id: overrides.id ?? "evt",
		"@timestamp": "2026-09-28T12:00:00.000Z",
		domain: { name: "tenant-a.example.com" },
		account: { id: "sub-123" },
		recipient: "alice@gmail.com",
		"recipient-provider": "Gmail",
		message: {
			headers: {
				"message-id": "abc@tenant-a.example.com",
				from: "noreply@tenant-a.example.com",
				subject: "Your receipt",
			},
		},
		...overrides,
	};
}

describe("toRfc2822()", () => {
	test("formats ISO 8601 input in UTC with numeric offset", () => {
		expect(toRfc2822("2026-09-29T16:05:07Z")).toBe("Tue, 29 Sep 2026 16:05:07 +0000");
	});

	test("passes RFC 2822 input through unchanged in value", () => {
		expect(toRfc2822("Tue, 29 Sep 2026 16:05:07 -0000")).toBe("Tue, 29 Sep 2026 16:05:07 +0000");
	});

	test("throws on unparseable input", () => {
		expect(() => toRfc2822("yesterday-ish")).toThrow(/Unparseable/);
	});
});

describe("resolveWindow()", () => {
	const now = new Date("2026-09-29T12:00:00Z");

	test("defaults to a 72 hour lookback", () => {
		expect(resolveWindow({}, now)).toEqual({
			start: "Sat, 26 Sep 2026 12:00:00 +0000",
			end: "Tue, 29 Sep 2026 12:00:00 +0000",
		});
	});

	test("honours lookback_hours", () => {
		expect(resolveWindow({ lookback_hours: 2 }, now).start).toBe("Tue, 29 Sep 2026 10:00:00 +0000");
	});

	test("caps lookback_hours at 90 days", () => {
		expect(resolveWindow({ lookback_hours: 100_000 }, now).start).toBe(
			"Wed, 01 Jul 2026 12:00:00 +0000",
		);
	});

	test("uses explicit start/end when both provided", () => {
		expect(
			resolveWindow({ start: "2026-09-01T00:00:00Z", end: "2026-09-02T00:00:00Z" }, now),
		).toEqual({
			start: "Tue, 01 Sep 2026 00:00:00 +0000",
			end: "Wed, 02 Sep 2026 00:00:00 +0000",
		});
	});
});

describe("normaliseMessageId()", () => {
	test("strips angle brackets and whitespace", () => {
		expect(normaliseMessageId(" <abc@example.com> ")).toBe("abc@example.com");
		expect(normaliseMessageId("abc@example.com")).toBe("abc@example.com");
	});
});

describe("buildLogsRequestBody()", () => {
	test("filters on recipient and searches subaccounts by default", () => {
		const body = buildLogsRequestBody({ recipient: " alice@gmail.com " }, WINDOW);

		expect(body.start).toBe(WINDOW.start);
		expect(body.end).toBe(WINDOW.end);
		expect(body.include_subaccounts).toBe(true);
		expect(body.filter).toEqual({
			AND: [
				{
					attribute: "recipient",
					comparator: "=",
					values: [{ label: "alice@gmail.com", value: "alice@gmail.com" }],
				},
			],
		});
		expect(body.pagination).toEqual({ sort: "timestamp:asc", limit: 100 });
	});

	test("adds message_id and domain predicates, normalising the message id", () => {
		const body = buildLogsRequestBody(
			{ recipient: "a@b.com", message_id: "<xyz@d.com>", domain: "d.com" },
			WINDOW,
		) as { filter: { AND: { attribute: string; values: { value: string }[] }[] } };

		expect(body.filter.AND.map((p) => p.attribute)).toEqual(["recipient", "message_id", "domain"]);
		expect(body.filter.AND[1].values[0].value).toBe("xyz@d.com");
	});

	test("respects include_subaccounts=false and carries a pagination token", () => {
		const body = buildLogsRequestBody(
			{ recipient: "a@b.com", include_subaccounts: false },
			WINDOW,
			"tok",
		);

		expect(body.include_subaccounts).toBe(false);
		expect(body.pagination).toEqual({ sort: "timestamp:asc", limit: 100, token: "tok" });
	});
});

describe("classify()", () => {
	test("delivered wins over earlier temporary failures", () => {
		const result = classify([
			event({ event: "accepted", "@timestamp": "2026-09-28T12:00:00Z" }),
			event({
				event: "failed",
				severity: "temporary",
				"@timestamp": "2026-09-28T12:01:00Z",
				"delivery-status": { code: 421, message: "try again later" },
			}),
			event({
				event: "delivered",
				"@timestamp": "2026-09-28T12:30:00Z",
				"delivery-status": { code: 250, message: "OK", "attempt-no": 2 },
			}),
		]);

		expect(result.outcome).toBe("delivered");
		expect(result.detail).toContain("Gmail");
		expect(result.detail).toContain("attempt 2");
	});

	test("delayed bounce flag overrides delivered", () => {
		const result = classify([
			event({ event: "delivered", "@timestamp": "2026-09-28T12:00:00Z" }),
			event({
				event: "failed",
				severity: "permanent",
				"@timestamp": "2026-09-28T13:00:00Z",
				flags: { "is-delayed-bounce": true },
				"delivery-status": { code: 550, message: "mailbox unavailable" },
			}),
		]);

		expect(result.outcome).toBe("delayed_bounce");
	});

	test("suppress-* reason classifies as suppressed", () => {
		const result = classify([
			event({
				event: "failed",
				severity: "permanent",
				reason: "suppress-bounce",
				"delivery-status": { code: 605, message: "Not delivering to previously bounced address" },
			}),
		]);

		expect(result.outcome).toBe("suppressed");
		expect(result.detail).toContain("suppress-bounce");
	});

	test("code 606 without reason classifies as suppressed", () => {
		const result = classify([
			event({ event: "failed", severity: "permanent", "delivery-status": { code: 606 } }),
		]);

		expect(result.outcome).toBe("suppressed");
	});

	test("reason old classifies as retries_exhausted", () => {
		const result = classify([
			event({
				event: "failed",
				severity: "permanent",
				reason: "old",
				"delivery-status": { code: 421, message: "Too old" },
			}),
		]);

		expect(result.outcome).toBe("retries_exhausted");
	});

	test("hard bounce classifies as bounced with SMTP detail", () => {
		const result = classify([
			event({
				event: "failed",
				severity: "permanent",
				reason: "bounce",
				"delivery-status": {
					code: 550,
					"enhanced-code": "5.1.1",
					message: "The email account that you tried to reach does not exist",
					"bounce-type": "hard",
				},
			}),
		]);

		expect(result.outcome).toBe("bounced");
		expect(result.detail).toContain("hard bounce");
		expect(result.detail).toContain("5.1.1");
		expect(result.detail).toContain("does not exist");
	});

	test("permanent failure without bounce markers is permanent_failure", () => {
		const result = classify([
			event({
				event: "failed",
				severity: "permanent",
				reason: "generic",
				"delivery-status": { code: 554, message: "policy rejection" },
			}),
		]);

		expect(result.outcome).toBe("permanent_failure");
		expect(result.detail).toBe("code 554 policy rejection");
	});

	test("temporary failure only is retrying", () => {
		const result = classify([
			event({ event: "accepted", "@timestamp": "2026-09-28T12:00:00Z" }),
			event({
				event: "failed",
				severity: "temporary",
				"@timestamp": "2026-09-28T12:05:00Z",
				"delivery-status": { code: 451, message: "greylisted" },
			}),
		]);

		expect(result.outcome).toBe("retrying");
		expect(result.detail).toContain("greylisted");
	});

	test("rejected classifies with reason", () => {
		const result = classify([
			event({ event: "rejected", reason: "Sandbox subdomains are for test purposes only" }),
		]);

		expect(result.outcome).toBe("rejected");
		expect(result.detail).toContain("Sandbox");
	});

	test("accepted only is accepted_pending", () => {
		expect(classify([event({ event: "accepted" })]).outcome).toBe("accepted_pending");
	});

	test("stored only is stored", () => {
		expect(classify([event({ event: "stored" })]).outcome).toBe("stored");
	});

	test("unrecognised events are unknown", () => {
		const result = classify([event({ event: "opened" })]);
		expect(result.outcome).toBe("unknown");
		expect(result.detail).toContain("opened");
	});
});

describe("buildMessageReports()", () => {
	test("groups events by message id + recipient and sorts timelines", () => {
		const reports = buildMessageReports([
			event({
				event: "delivered",
				"@timestamp": "2026-09-28T12:02:00Z",
				storage: { key: "stor-1" },
				tags: ["receipt"],
				template: { name: "receipt-v2" },
			}),
			event({ event: "accepted", "@timestamp": "2026-09-28T12:00:00Z" }),
			event({ event: "opened", "@timestamp": "2026-09-28T13:00:00Z" }),
			event({
				event: "failed",
				severity: "permanent",
				reason: "bounce",
				recipient: "bob@outlook.com",
				"recipient-provider": "Outlook",
				"@timestamp": "2026-09-28T12:01:00Z",
				"delivery-status": { code: 550, "bounce-type": "hard" },
			}),
		]);

		expect(reports).toHaveLength(2);

		const alice = reports.find((r) => r.recipient === "alice@gmail.com")!;
		expect(alice.message_id).toBe("abc@tenant-a.example.com");
		expect(alice.sending_domain).toBe("tenant-a.example.com");
		expect(alice.subaccount_id).toBe("sub-123");
		expect(alice.from).toBe("noreply@tenant-a.example.com");
		expect(alice.subject).toBe("Your receipt");
		expect(alice.storage_key).toBe("stor-1");
		expect(alice.tags).toEqual(["receipt"]);
		expect(alice.template).toBe("receipt-v2");
		expect(alice.outcome).toBe("delivered");
		expect(alice.engagement.opened).toBe(1);
		expect(alice.timeline.map((t) => t.event)).toEqual(["accepted", "delivered", "opened"]);

		const bob = reports.find((r) => r.recipient === "bob@outlook.com")!;
		expect(bob.outcome).toBe("bounced");
		expect(bob.timeline[0].delivery_status).toMatchObject({ code: 550, bounce_type: "hard" });
	});

	test("falls back to envelope sender and event id when headers are absent", () => {
		const reports = buildMessageReports([
			event({
				id: "evt-1",
				event: "accepted",
				message: undefined,
				envelope: { sender: "bounce@x.com" },
			}),
		]);

		expect(reports).toHaveLength(1);
		expect(reports[0].message_id).toBeNull();
		expect(reports[0].from).toBe("bounce@x.com");
	});
});

describe("suppressionPairs()", () => {
	test("dedupes domain/recipient pairs from messages", () => {
		const reports = buildMessageReports([
			event({ event: "accepted", "@timestamp": "2026-09-28T12:00:00Z" }),
			event({
				event: "accepted",
				"@timestamp": "2026-09-28T12:05:00Z",
				message: { headers: { "message-id": "second@tenant-a.example.com" } },
			}),
		]);

		expect(suppressionPairs(reports, {})).toEqual([
			{ domain: "tenant-a.example.com", recipient: "alice@gmail.com" },
		]);
	});

	test("falls back to caller-supplied domain and recipient when logs are empty", () => {
		expect(suppressionPairs([], { domain: "d.com", recipient: "a@b.com" })).toEqual([
			{ domain: "d.com", recipient: "a@b.com" },
		]);
		expect(suppressionPairs([], { recipient: "a@b.com" })).toEqual([]);
	});
});

function investigationOutput(
	params: Parameters<typeof buildInvestigationOutput>[0],
	events: LogEvent[],
	suppressions: SuppressionReport[] = [],
	suppressionGaps: string[] = [],
	truncated = false,
) {
	const messages: MessageReport[] = buildMessageReports(events);
	return buildInvestigationOutput(
		params,
		WINDOW,
		messages,
		events.length,
		suppressions,
		suppressionGaps,
		truncated,
	);
}

describe("buildInvestigationOutput()", () => {
	test("single message: summary outcome mirrors the message and adds the delivered caveat", () => {
		const events = [
			event({ event: "accepted", "@timestamp": "2026-09-28T12:00:00Z" }),
			event({ event: "delivered", "@timestamp": "2026-09-28T12:01:00Z" }),
		];

		const output = investigationOutput({ recipient: "alice@gmail.com" }, events);

		expect(output.summary.outcome).toBe("delivered");
		expect(output.summary.messages_found).toBe(1);
		expect(output.summary.events_found).toBe(2);
		expect(output.summary.sending_domains).toEqual(["tenant-a.example.com"]);
		expect(output.summary.subaccounts).toEqual(["sub-123"]);
		expect(output.query.include_subaccounts).toBe(true);
		expect(output.notes.some((n) => n.includes("not proof of inbox placement"))).toBe(true);
	});

	test("no events: not_found_in_window with guidance", () => {
		const output = investigationOutput({ recipient: "nobody@x.com" }, []);

		expect(output.summary.outcome).toBe("not_found_in_window");
		expect(output.messages).toEqual([]);
		expect(output.notes.some((n) => n.includes("widen the time window"))).toBe(true);
	});

	test("multiple messages: summary is multiple_messages", () => {
		const events = [
			event({ event: "accepted", "@timestamp": "2026-09-28T12:00:00Z" }),
			event({
				event: "accepted",
				"@timestamp": "2026-09-28T13:00:00Z",
				message: { headers: { "message-id": "two@tenant-a.example.com" } },
			}),
		];

		const output = investigationOutput({ recipient: "alice@gmail.com" }, events);

		expect(output.summary.outcome).toBe("multiple_messages");
		expect(output.summary.messages_found).toBe(2);
	});

	test("suppression hit adds a note; truncation adds a data gap without mutating the input", () => {
		const gaps = ["lookup failed"];
		const output = investigationOutput(
			{ recipient: "alice@gmail.com", message_id: "<abc@tenant-a.example.com>" },
			[event({ event: "accepted" })],
			[
				{
					domain: "tenant-a.example.com",
					recipient: "alice@gmail.com",
					bounce: { code: "550" },
					unsubscribe: null,
					complaint: null,
					allowlist: null,
				},
			],
			gaps,
			true,
		);

		expect(output.query.message_id).toBe("abc@tenant-a.example.com");
		expect(output.notes.some((n) => n.includes("suppression list for: tenant-a.example.com"))).toBe(
			true,
		);
		expect(output.summary.truncated).toBe(true);
		expect(output.data_gaps).toEqual([
			"lookup failed",
			"Stopped after 500 events; narrow the window or add a message_id to see the rest.",
		]);
		expect(gaps).toEqual(["lookup failed"]);
	});
});

describe("register()", () => {
	test('attaches _meta["com.mailgun/tags"] and registers under the expected name', () => {
		const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
		register({ registerTool: mockRegisterTool } as never, ["send"]);

		expect(mockRegisterTool.mock.calls[0][0]).toBe("investigate_message_delivery");
		const config = mockRegisterTool.mock.calls[0][1] as { _meta?: Record<string, unknown> };
		expect(config._meta).toEqual({ "com.mailgun/tags": ["send"] });
	});

	test("handler rejects a call with neither recipient nor message_id", async () => {
		const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
		register({ registerTool: mockRegisterTool } as never, ["send"]);
		const handler = mockRegisterTool.mock.calls[0][2] as (
			p: Record<string, unknown>,
		) => Promise<{ isError?: boolean; content: { text: string }[] }>;

		const result = await handler({});

		expect(result.isError).toBe(true);
		expect(JSON.parse(result.content[0].text).error.code).toBe("MISSING_IDENTIFIER");
	});

	test("handler rejects a half-specified window", async () => {
		const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
		register({ registerTool: mockRegisterTool } as never, ["send"]);
		const handler = mockRegisterTool.mock.calls[0][2] as (
			p: Record<string, unknown>,
		) => Promise<{ isError?: boolean; content: { text: string }[] }>;

		const result = await handler({ recipient: "a@b.com", start: "2026-09-01T00:00:00Z" });

		expect(result.isError).toBe(true);
		expect(JSON.parse(result.content[0].text).error.code).toBe("INVALID_WINDOW");
	});
});

describe("registerCustomTools()", () => {
	test("send tag registers investigate_message_delivery", () => {
		const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
		registerCustomTools({ registerTool: mockRegisterTool } as never, new Set(["send"]));

		expect(mockRegisterTool.mock.calls.map((c) => c[0])).toContain("investigate_message_delivery");
	});

	test("validate-only tag skips it", () => {
		const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
		registerCustomTools({ registerTool: mockRegisterTool } as never, new Set(["validate"]));

		expect(mockRegisterTool.mock.calls.map((c) => c[0])).not.toContain(
			"investigate_message_delivery",
		);
	});
});
