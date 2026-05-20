import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeMailgunRequest, MailgunApiError } from "../api.js";
import { META_TAGS_KEY, type Tag } from "../tags.js";

// --- Types ---

export interface MetricsSummaryOutput {
  metrics_raw: Record<string, number>;
  rates: Record<string, number>;
  data_gaps: string[];
  window: { start: string; end: string };
}

export interface MetricsSummaryError {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: string;
  };
}

interface MetricsResponse {
  start?: string;
  end?: string;
  resolution?: string;
  duration?: string;
  aggregates?: {
    metrics?: Record<string, unknown>;
  };
}

// --- Constants ---

const REQUIRED_METRICS = [
  "sent_count",
  "delivered_count",
  "permanent_failed_count",
  "temporary_failed_count",
  "hard_bounces_count",
  "complained_count",
] as const;

const DEFAULT_DURATION = "24h";

// --- Helpers ---

function getCount(metrics: Record<string, unknown>, key: string): number | undefined {
  const val = metrics[key];
  if (typeof val === "number" && !isNaN(val)) return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

// --- Request builder ---

export function buildMetricsRequestBody(params: {
  domain: string;
  start?: string;
  end?: string;
  duration?: string;
  timezone?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    metrics: [...REQUIRED_METRICS],
    include_aggregates: true,
    filter: {
      AND: [
        {
          attribute: "domain",
          comparator: "=",
          values: [{ label: params.domain, value: params.domain }],
        },
      ],
    },
  };

  if (params.start && params.end) {
    body.start = params.start;
    body.end = params.end;
  } else if (params.duration) {
    body.duration = params.duration;
  } else {
    body.duration = DEFAULT_DURATION;
  }

  if (params.timezone) {
    body.timezone = params.timezone;
  }

  return body;
}

// --- Output builder ---

export function buildMetricsSummaryOutput(data: MetricsResponse): MetricsSummaryOutput {
  const agg = data.aggregates?.metrics ?? {};
  const dataGaps: string[] = [];
  const metricsRaw: Record<string, number> = {};
  const rates: Record<string, number> = {};

  for (const key of REQUIRED_METRICS) {
    const val = getCount(agg, key);
    if (val === undefined) {
      dataGaps.push(key);
    } else {
      metricsRaw[key] = val;
    }
  }

  const sentCount = metricsRaw.sent_count;

  if (sentCount === undefined || sentCount <= 0) {
    if (!dataGaps.includes("sent_count")) {
      dataGaps.push("no_send_in_window");
    }
  } else {
    if (metricsRaw.delivered_count !== undefined) {
      rates.delivered_rate = metricsRaw.delivered_count / sentCount;
    }
    if (metricsRaw.permanent_failed_count !== undefined) {
      rates.permanent_fail_rate = metricsRaw.permanent_failed_count / sentCount;
    }
    if (metricsRaw.temporary_failed_count !== undefined) {
      rates.temporary_fail_rate = metricsRaw.temporary_failed_count / sentCount;
    }
    if (metricsRaw.hard_bounces_count !== undefined) {
      rates.hard_bounce_rate = metricsRaw.hard_bounces_count / sentCount;
    }
    if (metricsRaw.complained_count !== undefined) {
      rates.complaint_rate = metricsRaw.complained_count / sentCount;
    }
    if (
      metricsRaw.permanent_failed_count !== undefined &&
      metricsRaw.temporary_failed_count !== undefined
    ) {
      rates.total_fail_rate =
        (metricsRaw.permanent_failed_count + metricsRaw.temporary_failed_count) / sentCount;
    }
  }

  return {
    metrics_raw: metricsRaw,
    rates,
    data_gaps: dataGaps,
    window: {
      start: data.start ?? "",
      end: data.end ?? "",
    },
  };
}

// --- Error builder ---

function buildErrorResponse(
  code: string,
  message: string,
  retryable: boolean,
  details: string,
): MetricsSummaryError {
  return { error: { code, message, retryable, details } };
}

// --- Tool registration ---

export function register(server: McpServer, tags: readonly Tag[] = []): void {
  server.registerTool(
    "get_metrics_summary",
    {
      description:
        "Retrieve a structured summary of key sending metrics (counts and computed rates) for a domain and time window. Returns raw counts, decimal rates, and data-gap reporting. Use as a data primitive for delivery-health questions.",
      inputSchema: {
        domain: z.string().describe("Sending domain to retrieve metrics for."),
        start: z
          .string()
          .optional()
          .describe("Start of time window in ISO 8601 format (e.g. '2026-04-27T00:00:00Z')."),
        end: z.string().optional().describe("End of time window in ISO 8601 format."),
        duration: z
          .string()
          .optional()
          .describe(
            "Duration shorthand as alternative to start/end (e.g. '24h', '7d'). Defaults to '24h'.",
          ),
        timezone: z
          .string()
          .optional()
          .describe("Timezone for the window (e.g. 'UTC', 'America/New_York'). Defaults to UTC."),
      },
      _meta: { [META_TAGS_KEY]: [...tags] },
    },
    async (params) => {
      if (!params.domain || params.domain.trim() === "") {
        const err = buildErrorResponse(
          "INVALID_DOMAIN",
          "A domain is required to retrieve metrics.",
          false,
          "The 'domain' parameter was empty or missing.",
        );
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
        };
      }

      if ((params.start && !params.end) || (params.end && !params.start)) {
        const missing = params.start ? "end" : "start";
        const err = buildErrorResponse(
          "INVALID_WINDOW",
          "An unbounded time window is not supported. Provide both start and end, or use duration.",
          false,
          `Parameter '${missing === "end" ? "start" : "end"}' was provided without '${missing}'.`,
        );
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
        };
      }

      try {
        const body = buildMetricsRequestBody(
          params as {
            domain: string;
            start?: string;
            end?: string;
            duration?: string;
            timezone?: string;
          },
        );

        const result = (await makeMailgunRequest(
          "POST",
          "/v1/analytics/metrics",
          body,
          "application/json",
        )) as MetricsResponse;

        const output = buildMetricsSummaryOutput(result);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        };
      } catch (error) {
        const isApiError = error instanceof MailgunApiError;
        const statusCode = isApiError ? error.statusCode : 0;
        const retryable = statusCode >= 500 || statusCode === 429;

        const err = buildErrorResponse(
          "UPSTREAM_API_ERROR",
          "Unable to retrieve analytics metrics for the selected window.",
          retryable,
          isApiError
            ? `POST /v1/analytics/metrics returned ${error.statusCode}: ${error.apiMessage ?? error.message}`
            : `POST /v1/analytics/metrics failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
        };
      }
    },
  );
}
