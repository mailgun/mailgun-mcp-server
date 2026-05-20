import { describe, test, expect, vi } from "vitest";
import {
  buildMetricsRequestBody,
  buildMetricsSummaryOutput,
  register,
} from "../../src/custom-tools/get-metrics-summary.js";
import { registerCustomTools } from "../../src/custom-tools/index.js";

describe("buildMetricsRequestBody()", () => {
  test("includes domain filter and default duration when no window provided", () => {
    const body = buildMetricsRequestBody({ domain: "example.com" });

    expect(body.duration).toBe("24h");
    expect(body.start).toBeUndefined();
    expect(body.end).toBeUndefined();
    expect(body.filter).toEqual({
      AND: [
        {
          attribute: "domain",
          comparator: "=",
          values: [{ label: "example.com", value: "example.com" }],
        },
      ],
    });
  });

  test("uses start/end when both provided", () => {
    const body = buildMetricsRequestBody({
      domain: "example.com",
      start: "2026-04-27T00:00:00Z",
      end: "2026-04-27T23:59:59Z",
    });

    expect(body.start).toBe("2026-04-27T00:00:00Z");
    expect(body.end).toBe("2026-04-27T23:59:59Z");
    expect(body.duration).toBeUndefined();
  });

  test("uses explicit duration over default", () => {
    const body = buildMetricsRequestBody({
      domain: "example.com",
      duration: "7d",
    });

    expect(body.duration).toBe("7d");
    expect(body.start).toBeUndefined();
  });

  test("includes timezone when provided", () => {
    const body = buildMetricsRequestBody({
      domain: "example.com",
      timezone: "America/New_York",
    });

    expect(body.timezone).toBe("America/New_York");
  });

  test("requests the correct metric fields", () => {
    const body = buildMetricsRequestBody({ domain: "example.com" });

    expect(body.metrics).toEqual([
      "sent_count",
      "delivered_count",
      "permanent_failed_count",
      "temporary_failed_count",
      "hard_bounces_count",
      "complained_count",
    ]);
  });
});

describe("buildMetricsSummaryOutput()", () => {
  test("healthy mid-volume: all fields present, rates computed correctly", () => {
    const output = buildMetricsSummaryOutput({
      start: "2026-04-27T00:00:00Z",
      end: "2026-04-27T23:59:59Z",
      aggregates: {
        metrics: {
          sent_count: 120000,
          delivered_count: 91000,
          permanent_failed_count: 15840,
          temporary_failed_count: 6200,
          hard_bounces_count: 2200,
          complained_count: 180,
        },
      },
    });

    expect(output.metrics_raw).toEqual({
      sent_count: 120000,
      delivered_count: 91000,
      permanent_failed_count: 15840,
      temporary_failed_count: 6200,
      hard_bounces_count: 2200,
      complained_count: 180,
    });

    expect(output.rates.delivered_rate).toBeCloseTo(91000 / 120000);
    expect(output.rates.permanent_fail_rate).toBeCloseTo(15840 / 120000);
    expect(output.rates.temporary_fail_rate).toBeCloseTo(6200 / 120000);
    expect(output.rates.hard_bounce_rate).toBeCloseTo(2200 / 120000);
    expect(output.rates.complaint_rate).toBeCloseTo(180 / 120000);
    expect(output.rates.total_fail_rate).toBeCloseTo((15840 + 6200) / 120000);

    expect(output.data_gaps).toEqual([]);
    expect(output.window).toEqual({
      start: "2026-04-27T00:00:00Z",
      end: "2026-04-27T23:59:59Z",
    });
  });

  test("no-send window: sent_count is 0, rates empty, data_gaps includes marker", () => {
    const output = buildMetricsSummaryOutput({
      start: "2026-04-27T00:00:00Z",
      end: "2026-04-27T23:59:59Z",
      aggregates: {
        metrics: {
          sent_count: 0,
          delivered_count: 0,
          permanent_failed_count: 0,
          temporary_failed_count: 0,
          hard_bounces_count: 0,
          complained_count: 0,
        },
      },
    });

    expect(output.rates).toEqual({});
    expect(output.data_gaps).toContain("no_send_in_window");
    expect(output.metrics_raw.sent_count).toBe(0);
  });

  test("partial response: missing fields reported in data_gaps, affected rates skipped", () => {
    const output = buildMetricsSummaryOutput({
      start: "2026-04-27T00:00:00Z",
      end: "2026-04-27T23:59:59Z",
      aggregates: {
        metrics: {
          sent_count: 5000,
          delivered_count: 4650,
          permanent_failed_count: 200,
          temporary_failed_count: 120,
        },
      },
    });

    expect(output.data_gaps).toContain("hard_bounces_count");
    expect(output.data_gaps).toContain("complained_count");
    expect(output.data_gaps).toHaveLength(2);

    expect(output.rates.delivered_rate).toBeCloseTo(4650 / 5000);
    expect(output.rates.permanent_fail_rate).toBeCloseTo(200 / 5000);
    expect(output.rates.temporary_fail_rate).toBeCloseTo(120 / 5000);
    expect(output.rates.total_fail_rate).toBeCloseTo(320 / 5000);

    expect(output.rates.hard_bounce_rate).toBeUndefined();
    expect(output.rates.complaint_rate).toBeUndefined();
  });

  test("missing sent_count: reported in data_gaps, no rates computed", () => {
    const output = buildMetricsSummaryOutput({
      start: "2026-04-27T00:00:00Z",
      end: "2026-04-27T23:59:59Z",
      aggregates: {
        metrics: {
          delivered_count: 100,
        },
      },
    });

    expect(output.data_gaps).toContain("sent_count");
    expect(output.rates).toEqual({});
  });

  test("empty aggregates: all fields in data_gaps", () => {
    const output = buildMetricsSummaryOutput({
      start: "2026-04-27T00:00:00Z",
      end: "2026-04-27T23:59:59Z",
      aggregates: { metrics: {} },
    });

    expect(output.data_gaps).toEqual([
      "sent_count",
      "delivered_count",
      "permanent_failed_count",
      "temporary_failed_count",
      "hard_bounces_count",
      "complained_count",
    ]);
    expect(output.rates).toEqual({});
  });

  test("handles string metric values from API", () => {
    const output = buildMetricsSummaryOutput({
      start: "2026-04-27T00:00:00Z",
      end: "2026-04-27T23:59:59Z",
      aggregates: {
        metrics: {
          sent_count: "1000",
          delivered_count: "950",
          permanent_failed_count: "30",
          temporary_failed_count: "20",
          hard_bounces_count: "10",
          complained_count: "5",
        },
      },
    });

    expect(output.metrics_raw.sent_count).toBe(1000);
    expect(output.rates.delivered_rate).toBeCloseTo(0.95);
    expect(output.data_gaps).toEqual([]);
  });

  test("window echoes start/end from response", () => {
    const output = buildMetricsSummaryOutput({
      start: "2026-04-01T00:00:00Z",
      end: "2026-04-30T23:59:59Z",
      aggregates: { metrics: { sent_count: 100, delivered_count: 95 } },
    });

    expect(output.window).toEqual({
      start: "2026-04-01T00:00:00Z",
      end: "2026-04-30T23:59:59Z",
    });
  });
});

describe("buildMetricsRequestBody() window guardrails", () => {
  test("end without start falls to default duration (caught by tool validation)", () => {
    const body = buildMetricsRequestBody({
      domain: "example.com",
      end: "2026-04-27T23:59:59Z",
    });

    expect(body.duration).toBe("24h");
    expect(body.start).toBeUndefined();
    expect(body.end).toBeUndefined();
  });
});

describe("register()", () => {
  test('attaches _meta["com.mailgun/tags"] from the supplied tags', () => {
    const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
    register({ registerTool: mockRegisterTool } as never, ["send"]);

    expect(mockRegisterTool).toHaveBeenCalled();
    const config = mockRegisterTool.mock.calls[0][1] as {
      _meta?: Record<string, unknown>;
    };
    expect(config._meta).toEqual({ "com.mailgun/tags": ["send"] });
  });
});

describe("registerCustomTools()", () => {
  test('default activeTags="all" registers get_metrics_summary', () => {
    const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
    registerCustomTools({ registerTool: mockRegisterTool } as never);

    const names = mockRegisterTool.mock.calls.map((c) => c[0]);
    expect(names).toContain("get_metrics_summary");
  });

  test("disjoint activeTags skips registering get_metrics_summary", () => {
    const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
    registerCustomTools({ registerTool: mockRegisterTool } as never, new Set(["validate"]));

    expect(mockRegisterTool).not.toHaveBeenCalled();
  });

  test("intersecting activeTags registers get_metrics_summary with _meta", () => {
    const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();
    registerCustomTools({ registerTool: mockRegisterTool } as never, new Set(["send"]));

    expect(mockRegisterTool).toHaveBeenCalledTimes(1);
    expect(mockRegisterTool.mock.calls[0][0]).toBe("get_metrics_summary");
    const config = mockRegisterTool.mock.calls[0][1] as {
      _meta?: Record<string, unknown>;
    };
    expect(config._meta).toEqual({ "com.mailgun/tags": ["send"] });
  });
});
