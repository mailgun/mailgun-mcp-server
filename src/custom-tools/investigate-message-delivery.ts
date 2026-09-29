import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeMailgunRequest, MailgunApiError } from "../api.js";
import { META_TAGS_KEY, type Tag } from "../tags.js";

// --- Types ---

export interface InvestigateParams {
	recipient?: string;
	message_id?: string;
	domain?: string;
	start?: string;
	end?: string;
	lookback_hours?: number;
	include_subaccounts?: boolean;
}

export type Outcome =
	| "delivered"
	| "delayed_bounce"
	| "suppressed"
	| "bounced"
	| "retries_exhausted"
	| "permanent_failure"
	| "retrying"
	| "rejected"
	| "accepted_pending"
	| "stored"
	| "unknown";

export interface TimelineEntry {
	timestamp: string;
	event: string;
	severity?: string;
	reason?: string;
	delivery_status?: {
		code?: number;
		enhanced_code?: string;
		message?: string;
		description?: string;
		attempt_no?: number;
		bounce_type?: string;
		mx_host?: string;
		retry_seconds?: number;
	};
	log_level?: string;
}

export interface MessageReport {
	message_id: string | null;
	sending_domain: string;
	subaccount_id: string | null;
	from: string | null;
	recipient: string | null;
	recipient_provider: string | null;
	subject: string | null;
	tags: string[];
	template: string | null;
	storage_key: string | null;
	outcome: Outcome;
	outcome_detail: string;
	engagement: { opened: number; clicked: number; complained: boolean; unsubscribed: boolean };
	timeline: TimelineEntry[];
}

export interface SuppressionReport {
	domain: string;
	recipient: string;
	bounce: Record<string, unknown> | null;
	unsubscribe: Record<string, unknown> | null;
	complaint: Record<string, unknown> | null;
	allowlist: Record<string, unknown> | null;
}

interface DomainRecipient {
	domain: string;
	recipient: string;
}

export interface InvestigateOutput {
	query: {
		recipient: string | null;
		message_id: string | null;
		domain: string | null;
		start: string;
		end: string;
		include_subaccounts: boolean;
	};
	summary: {
		outcome: Outcome | "not_found_in_window" | "multiple_messages";
		messages_found: number;
		events_found: number;
		sending_domains: string[];
		subaccounts: string[];
		truncated: boolean;
	};
	messages: MessageReport[];
	suppressions: SuppressionReport[];
	data_gaps: string[];
	notes: string[];
}

export interface InvestigateError {
	error: { code: string; message: string; retryable: boolean; details: string };
}

export interface LogEvent {
	id: string;
	event: string;
	"@timestamp": string;
	account?: { id?: string };
	domain?: { name?: string };
	recipient?: string;
	"recipient-provider"?: string;
	envelope?: { sender?: string };
	storage?: { key?: string };
	template?: { name?: string };
	tags?: string[];
	message?: { headers?: { "message-id"?: string; from?: string; subject?: string } };
	flags?: { "is-delayed-bounce"?: boolean };
	"delivery-status"?: {
		code?: number;
		"enhanced-code"?: string;
		message?: string;
		description?: string;
		"attempt-no"?: number;
		"bounce-type"?: string;
		"mx-host"?: string;
		"retry-seconds"?: number;
	};
	"log-level"?: string;
	severity?: string;
	reason?: string;
}

interface LogsResponse {
	items?: LogEvent[];
	pagination?: { next?: string };
}

// --- Constants ---

const DEFAULT_LOOKBACK_HOURS = 72;
const MAX_LOOKBACK_HOURS = 24 * 90;
const PAGE_LIMIT = 100;
const MAX_PAGES = 5;
const MAX_SUPPRESSION_PAIRS = 10;

const NOTES = {
	delivered:
		"'delivered' means the recipient's mailbox provider accepted the message. It is not proof of inbox placement; the message may still be in spam or filtered by mailbox rules.",
	notFound:
		"No events matched. Check the region, widen the time window, confirm the recipient spelling, or confirm the send actually reached Mailgun (a client-side error before the API call leaves no log).",
	subaccounts:
		"Only subaccounts under the API key in use are searched. Customers on separate Mailgun accounts are not visible.",
	retrying:
		"Temporary failures are retried for up to 8 hours before Mailgun records a final 'too old' permanent failure.",
} as const;

// --- Time helpers ---

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function toRfc2822(input: string | Date): string {
	const date = input instanceof Date ? input : new Date(input);
	if (isNaN(date.getTime())) {
		throw new Error(`Unparseable timestamp: ${String(input)}`);
	}
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ` +
		`${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
	);
}

export function resolveWindow(
	params: Pick<InvestigateParams, "start" | "end" | "lookback_hours">,
	now: Date = new Date(),
): { start: string; end: string } {
	if (params.start && params.end) {
		return { start: toRfc2822(params.start), end: toRfc2822(params.end) };
	}
	const hours = Math.min(params.lookback_hours ?? DEFAULT_LOOKBACK_HOURS, MAX_LOOKBACK_HOURS);
	const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
	return { start: toRfc2822(start), end: toRfc2822(now) };
}

// --- Request builder ---

function predicate(attribute: string, value: string) {
	return { attribute, comparator: "=", values: [{ label: value, value }] };
}

export function buildLogsRequestBody(
	params: InvestigateParams,
	window: { start: string; end: string },
	token?: string,
): Record<string, unknown> {
	const and: Record<string, unknown>[] = [];
	if (params.recipient) and.push(predicate("recipient", params.recipient.trim()));
	if (params.message_id) and.push(predicate("message_id", normaliseMessageId(params.message_id)));
	if (params.domain) and.push(predicate("domain", params.domain.trim()));

	const pagination: Record<string, unknown> = { sort: "timestamp:asc", limit: PAGE_LIMIT };
	if (token) pagination.token = token;

	return {
		start: window.start,
		end: window.end,
		filter: { AND: and },
		include_subaccounts: params.include_subaccounts ?? true,
		include_totals: false,
		pagination,
	};
}

export function normaliseMessageId(id: string): string {
	return id.trim().replace(/^<|>$/g, "");
}

// --- Timeline / classification ---

function toTimelineEntry(ev: LogEvent): TimelineEntry {
	const ds = ev["delivery-status"];
	const entry: TimelineEntry = { timestamp: ev["@timestamp"], event: ev.event };
	if (ev.severity) entry.severity = ev.severity;
	if (ev.reason) entry.reason = ev.reason;
	if (ev["log-level"]) entry.log_level = ev["log-level"];
	if (ds) {
		entry.delivery_status = {
			code: ds.code,
			enhanced_code: ds["enhanced-code"],
			message: ds.message,
			description: ds.description,
			attempt_no: ds["attempt-no"],
			bounce_type: ds["bounce-type"],
			mx_host: ds["mx-host"],
			retry_seconds: ds["retry-seconds"],
		};
	}
	return entry;
}

function messageKey(ev: LogEvent): string {
	const id = ev.message?.headers?.["message-id"];
	const recipient = ev.recipient ?? "";
	return id ? `${normaliseMessageId(id)}|${recipient}` : `event:${ev.id}`;
}

export function classify(events: LogEvent[]): { outcome: Outcome; detail: string } {
	const sorted = [...events].sort((a, b) => a["@timestamp"].localeCompare(b["@timestamp"]));
	const types = new Set(sorted.map((e) => e.event));

	const delayedBounce = sorted.find(
		(e) => e.event === "failed" && e.flags?.["is-delayed-bounce"] === true,
	);
	if (delayedBounce) {
		return {
			outcome: "delayed_bounce",
			detail: `Provider accepted the message, then returned a bounce: ${describeFailure(delayedBounce)}`,
		};
	}

	if (types.has("delivered")) {
		const delivered = sorted.filter((e) => e.event === "delivered").at(-1)!;
		const attempts = delivered["delivery-status"]?.["attempt-no"];
		return {
			outcome: "delivered",
			detail: `Accepted by ${delivered["recipient-provider"] ?? "the mailbox provider"}${attempts ? ` on attempt ${attempts}` : ""}: ${delivered["delivery-status"]?.message ?? "no SMTP message recorded"}`,
		};
	}

	const permanent = sorted.filter((e) => e.event === "failed" && e.severity === "permanent").at(-1);
	if (permanent) {
		const reason = (permanent.reason ?? "").toLowerCase();
		const code = permanent["delivery-status"]?.code;
		if (reason.startsWith("suppress") || code === 605 || code === 606 || code === 607) {
			return {
				outcome: "suppressed",
				detail: `No delivery attempt was made; recipient is on a suppression list (${permanent.reason ?? `code ${code}`}).`,
			};
		}
		if (reason === "old") {
			return {
				outcome: "retries_exhausted",
				detail: `Retried until the retry window closed, never accepted: ${describeFailure(permanent)}`,
			};
		}
		if (reason === "bounce" || permanent["delivery-status"]?.["bounce-type"]) {
			return {
				outcome: "bounced",
				detail: `${permanent["delivery-status"]?.["bounce-type"] ?? "hard"} bounce from ${permanent["recipient-provider"] ?? "provider"}: ${describeFailure(permanent)}`,
			};
		}
		return { outcome: "permanent_failure", detail: describeFailure(permanent) };
	}

	const temporary = sorted.filter((e) => e.event === "failed" && e.severity === "temporary").at(-1);
	if (temporary) {
		return {
			outcome: "retrying",
			detail: `Last temporary failure: ${describeFailure(temporary)}`,
		};
	}

	if (types.has("rejected")) {
		const rejected = sorted.filter((e) => e.event === "rejected").at(-1)!;
		return {
			outcome: "rejected",
			detail: `Mailgun rejected the message before queueing: ${rejected.reason ?? rejected["delivery-status"]?.message ?? "no reason recorded"}`,
		};
	}

	if (types.has("accepted")) {
		return {
			outcome: "accepted_pending",
			detail:
				"Mailgun accepted the message; no delivery attempt has been logged yet in this window.",
		};
	}

	if (types.has("stored")) {
		return { outcome: "stored", detail: "Inbound message was stored by a route." };
	}

	return { outcome: "unknown", detail: `Events seen: ${[...types].join(", ") || "none"}` };
}

function describeFailure(ev: LogEvent): string {
	const ds = ev["delivery-status"];
	const parts: string[] = [];
	if (ds?.code !== undefined) parts.push(`code ${ds.code}`);
	if (ds?.["enhanced-code"]) parts.push(ds["enhanced-code"]);
	if (ds?.message) parts.push(ds.message);
	else if (ds?.description) parts.push(ds.description);
	if (ev.reason && !parts.length) parts.push(ev.reason);
	return parts.join(" ") || "no failure detail recorded";
}

export function buildMessageReports(events: LogEvent[]): MessageReport[] {
	const groups = new Map<string, LogEvent[]>();
	for (const ev of events) {
		const key = messageKey(ev);
		const list = groups.get(key);
		if (list) list.push(ev);
		else groups.set(key, [ev]);
	}

	const reports: MessageReport[] = [];
	for (const group of groups.values()) {
		const sorted = [...group].sort((a, b) => a["@timestamp"].localeCompare(b["@timestamp"]));
		const first = sorted[0];
		const pick = <T>(fn: (e: LogEvent) => T | undefined): T | null => {
			for (const e of sorted) {
				const v = fn(e);
				if (v !== undefined && v !== null && v !== "") return v;
			}
			return null;
		};
		const { outcome, detail } = classify(sorted);
		const rawId = pick((e) => e.message?.headers?.["message-id"]);

		reports.push({
			message_id: rawId ? normaliseMessageId(rawId) : null,
			sending_domain: first.domain?.name ?? "",
			subaccount_id: pick((e) => e.account?.id),
			from: pick((e) => e.message?.headers?.from ?? e.envelope?.sender),
			recipient: pick((e) => e.recipient),
			recipient_provider: pick((e) => e["recipient-provider"]),
			subject: pick((e) => e.message?.headers?.subject),
			tags: [...new Set(sorted.flatMap((e) => e.tags ?? []))],
			template: pick((e) => e.template?.name),
			storage_key: pick((e) => e.storage?.key),
			outcome,
			outcome_detail: detail,
			engagement: {
				opened: sorted.filter((e) => e.event === "opened").length,
				clicked: sorted.filter((e) => e.event === "clicked").length,
				complained: sorted.some((e) => e.event === "complained"),
				unsubscribed: sorted.some((e) => e.event === "unsubscribed"),
			},
			timeline: sorted.map(toTimelineEntry),
		});
	}

	reports.sort((a, b) => a.timeline[0].timestamp.localeCompare(b.timeline[0].timestamp));
	return reports;
}

// --- Suppression lookups ---

async function lookupOrNull(
	path: string,
	dataGaps: string[],
): Promise<Record<string, unknown> | null> {
	try {
		const result = await makeMailgunRequest("GET", path);
		return (result as Record<string, unknown>) ?? null;
	} catch (error) {
		if (error instanceof MailgunApiError && error.statusCode === 404) return null;
		dataGaps.push(
			`GET ${path} failed: ${error instanceof MailgunApiError ? `${error.statusCode} ${error.apiMessage ?? error.message}` : String(error)}`,
		);
		return null;
	}
}

async function lookupSuppressions(
	pairs: DomainRecipient[],
): Promise<{ reports: SuppressionReport[]; dataGaps: string[] }> {
	const dataGaps: string[] = [];
	const reports: SuppressionReport[] = [];
	for (const { domain, recipient } of pairs.slice(0, MAX_SUPPRESSION_PAIRS)) {
		const encodedDomain = encodeURIComponent(domain);
		const encodedRecipient = encodeURIComponent(recipient);
		const [bounce, unsubscribe, complaint, allowlist] = await Promise.all([
			lookupOrNull(`/v3/${encodedDomain}/bounces/${encodedRecipient}`, dataGaps),
			lookupOrNull(`/v3/${encodedDomain}/unsubscribes/${encodedRecipient}`, dataGaps),
			lookupOrNull(`/v3/${encodedDomain}/complaints/${encodedRecipient}`, dataGaps),
			lookupOrNull(`/v3/${encodedDomain}/whitelists/${encodedRecipient}`, dataGaps),
		]);
		reports.push({ domain, recipient, bounce, unsubscribe, complaint, allowlist });
	}
	if (pairs.length > MAX_SUPPRESSION_PAIRS) {
		dataGaps.push(
			`Suppression lookup capped at ${MAX_SUPPRESSION_PAIRS} domain/recipient pairs (${pairs.length} found).`,
		);
	}
	return { reports, dataGaps };
}

export function suppressionPairs(
	messages: MessageReport[],
	params: InvestigateParams,
): DomainRecipient[] {
	const seen = new Set<string>();
	const pairs: DomainRecipient[] = [];
	const add = (domain: string | null | undefined, recipient: string | null | undefined) => {
		if (!domain || !recipient) return;
		const key = `${domain.toLowerCase()}|${recipient.toLowerCase()}`;
		if (seen.has(key)) return;
		seen.add(key);
		pairs.push({ domain, recipient });
	};
	for (const message of messages)
		add(message.sending_domain, message.recipient ?? params.recipient);
	if (messages.length === 0) add(params.domain, params.recipient);
	return pairs;
}

// --- Output builder ---

export function buildInvestigationOutput(
	params: InvestigateParams,
	window: { start: string; end: string },
	messages: MessageReport[],
	eventsFound: number,
	suppressions: SuppressionReport[],
	suppressionGaps: string[],
	truncated: boolean,
): InvestigateOutput {
	const dataGaps = [...suppressionGaps];
	const notes: string[] = [NOTES.subaccounts];

	let outcome: InvestigateOutput["summary"]["outcome"];
	if (messages.length === 0) {
		outcome = "not_found_in_window";
		notes.push(NOTES.notFound);
	} else if (messages.length === 1) {
		outcome = messages[0].outcome;
	} else {
		outcome = "multiple_messages";
	}

	if (messages.some((m) => m.outcome === "delivered")) notes.push(NOTES.delivered);
	if (messages.some((m) => m.outcome === "retrying" || m.outcome === "accepted_pending")) {
		notes.push(NOTES.retrying);
	}
	const listed = suppressions.filter((s) => s.bounce || s.unsubscribe || s.complaint);
	if (listed.length > 0) {
		notes.push(
			`Recipient is on a suppression list for: ${listed.map((s) => s.domain).join(", ")}. Future sends from that domain will be dropped without a delivery attempt.`,
		);
	}
	if (truncated) {
		dataGaps.push(
			`Stopped after ${MAX_PAGES * PAGE_LIMIT} events; narrow the window or add a message_id to see the rest.`,
		);
	}

	return {
		query: {
			recipient: params.recipient?.trim() ?? null,
			message_id: params.message_id ? normaliseMessageId(params.message_id) : null,
			domain: params.domain?.trim() ?? null,
			start: window.start,
			end: window.end,
			include_subaccounts: params.include_subaccounts ?? true,
		},
		summary: {
			outcome,
			messages_found: messages.length,
			events_found: eventsFound,
			sending_domains: [...new Set(messages.map((m) => m.sending_domain).filter(Boolean))],
			subaccounts: [
				...new Set(messages.map((m) => m.subaccount_id).filter((s): s is string => !!s)),
			],
			truncated,
		},
		messages,
		suppressions,
		data_gaps: dataGaps,
		notes,
	};
}

// --- Fetch ---

async function fetchAllLogs(
	params: InvestigateParams,
	window: { start: string; end: string },
): Promise<{ events: LogEvent[]; truncated: boolean }> {
	const events: LogEvent[] = [];
	let token: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const body = buildLogsRequestBody(params, window, token);
		const res = (await makeMailgunRequest(
			"POST",
			"/v1/analytics/logs",
			body,
			"application/json",
		)) as LogsResponse;
		const items = res.items ?? [];
		events.push(...items);
		if (items.length < PAGE_LIMIT || !res.pagination?.next) {
			return { events, truncated: false };
		}
		token = res.pagination.next;
	}
	return { events, truncated: true };
}

// --- Error builder ---

function buildErrorResponse(
	code: string,
	message: string,
	retryable: boolean,
	details: string,
): InvestigateError {
	return { error: { code, message, retryable, details } };
}

// --- Tool registration ---

export function register(server: McpServer, tags: readonly Tag[] = []): void {
	server.registerTool(
		"investigate_message_delivery",
		{
			description:
				"Answer 'why didn't this email arrive?' for one recipient or message. Searches logs across the account and all subaccounts, builds a per-message event timeline, classifies the outcome (delivered, suppressed, bounced, retrying, rejected, not found), and checks the recipient against the sending domain's bounce, unsubscribe, complaint, and allowlist entries. Read-only; does not resend or modify suppressions.",
			inputSchema: {
				recipient: z
					.string()
					.optional()
					.describe("Recipient email address to investigate. Provide this and/or message_id."),
				message_id: z
					.string()
					.optional()
					.describe(
						"Message-Id returned by the send call or found in headers. Angle brackets are optional.",
					),
				domain: z
					.string()
					.optional()
					.describe(
						"Sending domain to restrict the search to. Leave empty to search every domain the key can see.",
					),
				start: z
					.string()
					.optional()
					.describe("Start of the window (ISO 8601 or RFC 2822). Requires end."),
				end: z
					.string()
					.optional()
					.describe("End of the window (ISO 8601 or RFC 2822). Requires start."),
				lookback_hours: z
					.number()
					.int()
					.positive()
					.max(MAX_LOOKBACK_HOURS)
					.optional()
					.describe(
						`Hours before now to search when start/end are not given. Defaults to ${DEFAULT_LOOKBACK_HOURS}. Bounded by your plan's log retention.`,
					),
				include_subaccounts: z
					.boolean()
					.optional()
					.describe("Search subaccounts under this API key as well. Defaults to true."),
			},
			_meta: { [META_TAGS_KEY]: [...tags] },
		},
		async (params) => {
			const input = params as InvestigateParams;

			if (!input.recipient?.trim() && !input.message_id?.trim()) {
				const err = buildErrorResponse(
					"MISSING_IDENTIFIER",
					"Provide a recipient address, a message_id, or both.",
					false,
					"Neither 'recipient' nor 'message_id' was supplied.",
				);
				return {
					isError: true,
					content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
				};
			}

			if ((input.start && !input.end) || (input.end && !input.start)) {
				const err = buildErrorResponse(
					"INVALID_WINDOW",
					"Provide both start and end, or neither (use lookback_hours).",
					false,
					`'${input.start ? "start" : "end"}' was provided without its counterpart.`,
				);
				return {
					isError: true,
					content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
				};
			}

			let window: { start: string; end: string };
			try {
				window = resolveWindow(input);
			} catch (error) {
				const err = buildErrorResponse(
					"INVALID_WINDOW",
					"Could not parse start/end timestamps.",
					false,
					error instanceof Error ? error.message : String(error),
				);
				return {
					isError: true,
					content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
				};
			}

			let events: LogEvent[];
			let truncated: boolean;
			try {
				({ events, truncated } = await fetchAllLogs(input, window));
			} catch (error) {
				const isApiError = error instanceof MailgunApiError;
				const status = isApiError ? error.statusCode : 0;
				const err = buildErrorResponse(
					"UPSTREAM_API_ERROR",
					"Unable to query logs for the selected window.",
					status >= 500 || status === 429,
					isApiError
						? `POST /v1/analytics/logs returned ${status}: ${error.apiMessage ?? error.message}`
						: `POST /v1/analytics/logs failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				return {
					isError: true,
					content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
				};
			}

			const messages = buildMessageReports(events);
			const { reports, dataGaps } = await lookupSuppressions(suppressionPairs(messages, input));
			const output = buildInvestigationOutput(
				input,
				window,
				messages,
				events.length,
				reports,
				dataGaps,
				truncated,
			);

			return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
		},
	);
}
