import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeMailgunRequest, MailgunApiError } from "../api.js";
import { META_TAGS_KEY, type Tag } from "../tags.js";
import { formatErrorMessage } from "../tools.js";
import { errorResult, upstreamErrorResult } from "./shared.js";

// --- Types ---

export interface InvestigateParams {
  recipient?: string;
  message_id?: string;
  lookback_hours?: number;
}

export type Outcome =
  | "delivered"
  | "failed"
  | "suppressed"
  | "retrying"
  | "rejected"
  | "accepted_pending"
  | "unknown";

export interface TimeWindow {
  start: string;
  end: string;
}

export interface LogEvent {
  id: string;
  event: string;
  "@timestamp": string;
  account?: { id?: string; "parent-id"?: string };
  domain?: { name?: string };
  recipient?: string;
  "recipient-provider"?: string;
  message?: { headers?: { "message-id"?: string; subject?: string } };
  flags?: { "is-delayed-bounce"?: boolean };
  "delivery-status"?: {
    code?: number;
    "enhanced-code"?: string;
    message?: string;
    description?: string;
    "attempt-no"?: number;
    "bounce-type"?: string;
  };
  severity?: string;
  reason?: string;
}

interface LogsResponse {
  items?: LogEvent[];
  pagination?: { next?: string };
}

export interface MessageReport {
  message_id: string | null;
  sending_domain: string;
  subaccount_id: string | null;
  recipient: string | null;
  recipient_provider: string | null;
  subject: string | null;
  outcome: Outcome;
  outcome_detail: string;
  timeline: {
    timestamp: string;
    event: string;
    severity?: string;
    reason?: string;
    delivery_status?: LogEvent["delivery-status"];
  }[];
}

export interface SuppressionReport {
  domain: string;
  recipient: string;
  bounce: Record<string, unknown> | null;
  unsubscribe: Record<string, unknown> | null;
  complaint: Record<string, unknown> | null;
  allowlist: Record<string, unknown> | null;
}

export interface InvestigateOutput {
  window: TimeWindow;
  summary: {
    outcome: Outcome | "not_found_in_window" | "multiple_messages";
    messages_found: number;
    truncated: boolean;
  };
  messages: MessageReport[];
  suppressions: SuppressionReport[];
  data_gaps: string[];
  notes: string[];
}

// --- Constants ---

const DEFAULT_LOOKBACK_HOURS = 72;
const MAX_LOOKBACK_HOURS = 24 * 90;
const PAGE_LIMIT = 100;
const MAX_PAGES = 5;
const SUPPRESSION_CODES = [605, 606, 607];

const NOTES = {
  delivered:
    "'delivered' means the recipient's mailbox provider accepted the message. It is not proof of inbox placement; the message may still be in spam or filtered by mailbox rules.",
  notFound:
    "No events matched. Check the region, increase lookback_hours, confirm the recipient spelling, or confirm the send actually reached Mailgun (a client-side error before the API call leaves no log).",
} as const;

// --- Helpers ---

function toRfc2822(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000");
}

function normalizeMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, "");
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

// --- Request builder ---

export function buildLogsWindow(
  lookbackHours = DEFAULT_LOOKBACK_HOURS,
  now = new Date(),
): TimeWindow {
  const start = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  return { start: toRfc2822(start), end: toRfc2822(now) };
}

export function buildLogsRequestBody(
  params: InvestigateParams,
  window: TimeWindow,
  token?: string,
): Record<string, unknown> {
  const predicate = (attribute: string, value: string) => ({
    attribute,
    comparator: "=",
    values: [{ label: value, value }],
  });
  const and: Record<string, unknown>[] = [];
  if (params.recipient?.trim()) and.push(predicate("recipient", params.recipient.trim()));
  if (params.message_id?.trim()) {
    and.push(predicate("message_id", normalizeMessageId(params.message_id)));
  }

  const pagination: Record<string, unknown> = { sort: "timestamp:desc", limit: PAGE_LIMIT };
  if (token) pagination.token = token;

  return {
    start: window.start,
    end: window.end,
    filter: { AND: and },
    include_subaccounts: true,
    include_totals: false,
    pagination,
  };
}

// --- Classification ---

export function classify(events: LogEvent[]): { outcome: Outcome; detail: string } {
  const last = (match: (e: LogEvent) => boolean) => events.filter(match).at(-1);

  const delayedBounce = last((e) => e.event === "failed" && !!e.flags?.["is-delayed-bounce"]);
  if (delayedBounce) {
    return {
      outcome: "failed",
      detail: `Provider accepted the message, then returned a bounce: ${describeFailure(delayedBounce)}`,
    };
  }

  const delivered = last((e) => e.event === "delivered");
  if (delivered) {
    const attempts = delivered["delivery-status"]?.["attempt-no"];
    return {
      outcome: "delivered",
      detail: `Accepted by ${delivered["recipient-provider"] ?? "the mailbox provider"}${attempts ? ` on attempt ${attempts}` : ""}: ${delivered["delivery-status"]?.message ?? "no SMTP message recorded"}`,
    };
  }

  const permanent = last((e) => e.event === "failed" && e.severity === "permanent");
  if (permanent) {
    const reason = permanent.reason?.toLowerCase() ?? "";
    const code = permanent["delivery-status"]?.code;
    const bounceType = permanent["delivery-status"]?.["bounce-type"];
    if (reason.startsWith("suppress") || SUPPRESSION_CODES.includes(code ?? 0)) {
      return {
        outcome: "suppressed",
        detail: `No delivery attempt was made; recipient is on a suppression list (${permanent.reason ?? `code ${code}`}).`,
      };
    }
    if (reason === "old") {
      return {
        outcome: "failed",
        detail: `Retried until the retry window closed, never accepted: ${describeFailure(permanent)}`,
      };
    }
    if (reason === "bounce" || bounceType) {
      return {
        outcome: "failed",
        detail: `${bounceType ?? "hard"} bounce from ${permanent["recipient-provider"] ?? "provider"}: ${describeFailure(permanent)}`,
      };
    }
    return { outcome: "failed", detail: describeFailure(permanent) };
  }

  const temporary = last((e) => e.event === "failed" && e.severity === "temporary");
  if (temporary) {
    return { outcome: "retrying", detail: `Last temporary failure: ${describeFailure(temporary)}` };
  }

  const rejected = last((e) => e.event === "rejected");
  if (rejected) {
    return {
      outcome: "rejected",
      detail: `Mailgun rejected the message before queueing: ${rejected.reason ?? rejected["delivery-status"]?.message ?? "no reason recorded"}`,
    };
  }

  if (last((e) => e.event === "accepted")) {
    return {
      outcome: "accepted_pending",
      detail:
        "Mailgun accepted the message; no delivery attempt has been logged yet in this window.",
    };
  }

  return {
    outcome: "unknown",
    detail: `Events seen: ${[...new Set(events.map((e) => e.event))].join(", ") || "none"}`,
  };
}

// --- Output builder ---

export function buildMessageReports(events: LogEvent[]): MessageReport[] {
  const groups = new Map<string, LogEvent[]>();
  for (const ev of events) {
    const id = ev.message?.headers?.["message-id"];
    const key = `${id ? normalizeMessageId(id) : ""}|${ev.recipient ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(ev);
    else groups.set(key, [ev]);
  }

  const reports = [...groups.values()].map((group): MessageReport => {
    const sorted = group.sort((a, b) => a["@timestamp"].localeCompare(b["@timestamp"]));
    const pick = <T>(fn: (e: LogEvent) => T | undefined): T | null =>
      sorted.map(fn).find((v) => v) ?? null;
    const account = pick((e) => e.account);
    const messageId = pick((e) => e.message?.headers?.["message-id"]);
    const { outcome, detail } = classify(sorted);

    return {
      message_id: messageId && normalizeMessageId(messageId),
      sending_domain: pick((e) => e.domain?.name) ?? "",
      subaccount_id: account?.["parent-id"] ? (account.id ?? null) : null,
      recipient: pick((e) => e.recipient),
      recipient_provider: pick((e) => e["recipient-provider"]),
      subject: pick((e) => e.message?.headers?.subject),
      outcome,
      outcome_detail: detail,
      timeline: sorted.map((e) => ({
        timestamp: e["@timestamp"],
        event: e.event,
        severity: e.severity,
        reason: e.reason,
        delivery_status: e["delivery-status"],
      })),
    };
  });

  return reports.sort((a, b) => a.timeline[0].timestamp.localeCompare(b.timeline[0].timestamp));
}

export function buildInvestigationOutput(result: {
  window: TimeWindow;
  messages: MessageReport[];
  suppressions: SuppressionReport[];
  dataGaps: string[];
  truncated: boolean;
}): InvestigateOutput {
  const { window, messages, suppressions, truncated } = result;
  const dataGaps = [...result.dataGaps];
  const notes: string[] = [];

  let outcome: InvestigateOutput["summary"]["outcome"];
  if (messages.length === 0) {
    outcome = "not_found_in_window";
    notes.push(NOTES.notFound);
  } else {
    outcome = messages.length === 1 ? messages[0].outcome : "multiple_messages";
  }
  if (messages.some((m) => m.outcome === "delivered")) notes.push(NOTES.delivered);
  if (truncated) {
    dataGaps.push(
      `Stopped after the newest ${MAX_PAGES * PAGE_LIMIT} events; reduce lookback_hours or add a message_id to see older events.`,
    );
  }

  return {
    window,
    summary: { outcome, messages_found: messages.length, truncated },
    messages,
    suppressions,
    data_gaps: dataGaps,
    notes,
  };
}

// --- Fetch ---

async function fetchLogs(
  params: InvestigateParams,
  window: TimeWindow,
): Promise<{ events: LogEvent[]; truncated: boolean }> {
  const events: LogEvent[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = (await makeMailgunRequest(
      "POST",
      "/v1/analytics/logs",
      buildLogsRequestBody(params, window, token),
      "application/json",
    )) as LogsResponse;
    const items = result.items ?? [];
    events.push(...items);
    if (items.length < PAGE_LIMIT || !result.pagination?.next) {
      return { events, truncated: false };
    }
    token = result.pagination.next;
  }
  return { events, truncated: true };
}

async function fetchSuppression(
  path: string,
  subaccountId: string | null,
  dataGaps: string[],
): Promise<Record<string, unknown> | null> {
  const headers = subaccountId ? { "X-Mailgun-On-Behalf-Of": subaccountId } : undefined;
  try {
    const result = await makeMailgunRequest("GET", path, null, undefined, headers);
    return result as Record<string, unknown>;
  } catch (error) {
    const notListed =
      error instanceof MailgunApiError &&
      error.statusCode === 404 &&
      !/^domain not found/i.test(error.apiMessage ?? "");
    if (!notListed) dataGaps.push(formatErrorMessage(error, "GET", path));
    return null;
  }
}

async function fetchSuppressions(
  messages: MessageReport[],
): Promise<{ suppressions: SuppressionReport[]; dataGaps: string[] }> {
  const targets = new Map<string, MessageReport>();
  for (const m of messages) {
    if (m.sending_domain && m.recipient) {
      targets.set(`${m.sending_domain}|${m.recipient}`.toLowerCase(), m);
    }
  }

  const dataGaps: string[] = [];
  const suppressions = await Promise.all(
    [...targets.values()].map(async ({ sending_domain, recipient, subaccount_id }) => {
      const base = `/v3/${encodeURIComponent(sending_domain)}`;
      const address = encodeURIComponent(recipient!);
      const [bounce, unsubscribe, complaint, allowlist] = await Promise.all(
        ["bounces", "unsubscribes", "complaints", "whitelists"].map((list) =>
          fetchSuppression(`${base}/${list}/${address}`, subaccount_id, dataGaps),
        ),
      );
      return {
        domain: sending_domain,
        recipient: recipient!,
        bounce,
        unsubscribe,
        complaint,
        allowlist,
      };
    }),
  );
  return { suppressions, dataGaps };
}

// --- Tool registration ---

export function register(server: McpServer, tags: readonly Tag[] = []): void {
  server.registerTool(
    "investigate_message_delivery",
    {
      description:
        "Answer 'why didn't this email arrive?' for one recipient or message. Searches logs across the account and all subaccounts under this API key, builds a per-message event timeline, classifies the outcome (delivered, failed, suppressed, retrying, rejected, accepted_pending, unknown), and checks the recipient against the sending domain's bounce, unsubscribe, complaint, and allowlist entries. Read-only; does not resend or modify suppressions.",
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
        lookback_hours: z
          .number()
          .int()
          .positive()
          .max(MAX_LOOKBACK_HOURS)
          .optional()
          .describe(
            `Hours before now to search. Defaults to ${DEFAULT_LOOKBACK_HOURS}. Bounded by your plan's log retention.`,
          ),
      },
      _meta: { [META_TAGS_KEY]: [...tags] },
    },
    async (params) => {
      if (!params.recipient?.trim() && !params.message_id?.trim()) {
        return errorResult(
          "MISSING_IDENTIFIER",
          "Provide a recipient address, a message_id, or both.",
          false,
          "Neither 'recipient' nor 'message_id' was supplied.",
        );
      }

      const window = buildLogsWindow(params.lookback_hours);
      let logs: Awaited<ReturnType<typeof fetchLogs>>;
      try {
        logs = await fetchLogs(params, window);
      } catch (error) {
        return upstreamErrorResult(
          error,
          "POST /v1/analytics/logs",
          "Unable to query logs for the selected window.",
        );
      }

      const messages = buildMessageReports(logs.events);
      const { suppressions, dataGaps } = await fetchSuppressions(messages);
      const output = buildInvestigationOutput({
        window,
        messages,
        suppressions,
        dataGaps,
        truncated: logs.truncated,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    },
  );
}
