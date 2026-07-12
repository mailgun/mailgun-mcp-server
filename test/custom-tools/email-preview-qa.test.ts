import { describe, expect, test } from "vitest";
import { MailgunApiError } from "../../src/api.js";
import {
  CHECK_NAMES,
  collectEmailPreviewQa,
  type CheckName,
  type PollDeps,
} from "../../src/custom-tools/email-preview-qa.js";
import {
  ACCESSIBILITY_RESULT,
  CODE_ANALYSIS_PROCESSING,
  CODE_ANALYSIS_RESULT,
  IMAGE_RESULT,
  LINK_RESULT,
  RENDER_CHECK_REFERENCE_MISSING,
  RENDER_COMPLETE,
  RENDER_EMPTY,
  RENDER_PARTIAL,
  RENDER_STRAGGLER,
} from "../fixtures/email-preview-qa-contract.js";

type Route = unknown | (() => unknown);

function fakeDeps(routes: Record<string, Route>): { deps: PollDeps; requests: string[] } {
  let current = 0;
  const requests: string[] = [];
  return {
    requests,
    deps: {
      request: async (method, path) => {
        requests.push(`${method} ${path}`);
        const route = routes[path];
        if (route === undefined) throw new MailgunApiError("not found", 404);
        return typeof route === "function" ? (route as () => unknown)() : route;
      },
      now: () => current,
      sleep: async (ms) => {
        current += ms;
      },
    },
  };
}

const STATUS_PATH = "/v2/preview/tests/preview_test_001";
const RESULT_ROUTES: Record<string, unknown> = {
  "/v1/inspect/links/link_001": LINK_RESULT,
  "/v1/inspect/images/image_001": IMAGE_RESULT,
  "/v1/inspect/accessibility/access_001": ACCESSIBILITY_RESULT,
  "/v1/inspect/analyze/code_001": CODE_ANALYSIS_RESULT,
};

function renderFor(name: CheckName, id: string): Record<string, unknown> {
  const contentChecking = Object.fromEntries(CHECK_NAMES.map((check) => [check, null]));
  contentChecking[name] = { items: { id } };
  return {
    completed: ["gmail_chrome"],
    processing: [],
    bounced: [],
    content_checking: contentChecking,
  };
}

describe("collectEmailPreviewQa", () => {
  test("returns the complete QA summary through one workflow-facing seam", async () => {
    const { deps, requests } = fakeDeps({ [STATUS_PATH]: RENDER_COMPLETE, ...RESULT_ROUTES });
    const output = await collectEmailPreviewQa(
      { testId: "preview_test_001", timeoutMs: 30_000 },
      deps,
    );

    expect(output).toMatchObject({
      test_id: "preview_test_001",
      status: "complete",
      timed_out: false,
      summary: { total_clients: 3, completed: 3, processing: 0, bounced: 0 },
      issue_counts: {
        total: 6,
        by_check: { link_validation: 2, image_validation: 1, accessibility: 3 },
        by_severity: { critical: 2, unknown: 1, moderate: 1, serious: 2 },
      },
      checks: {
        link_validation: { status: "complete", result_id: "link_001", failures: 2 },
        image_validation: { status: "complete", result_id: "image_001", failures: 1 },
        accessibility: {
          status: "complete",
          result_id: "access_001",
          failures: 3,
          failure_rules: 2,
          needs_review: 1,
        },
        code_analysis: {
          status: "complete",
          result_id: "code_001",
          count: 2,
          instances: 3,
          by_feature: { "html-width": 2, "target-attribute": 1 },
        },
      },
    });
    expect(requests).toHaveLength(5);
  });

  test.each([
    {
      name: "link_validation" as const,
      id: "link/a",
      path: "/v1/inspect/links/link%2Fa",
      payload: LINK_RESULT,
      expected: {
        passes: 2,
        failures: 2,
        informational: 1,
        by_severity: { critical: 1, unknown: 1 },
      },
    },
    {
      name: "image_validation" as const,
      id: "image/a",
      path: "/v1/inspect/images/image%2Fa",
      payload: IMAGE_RESULT,
      expected: { passes: 1, failures: 1, informational: 1, by_severity: { moderate: 1 } },
    },
    {
      name: "accessibility" as const,
      id: "access/a",
      path: "/v1/inspect/accessibility/access%2Fa",
      payload: ACCESSIBILITY_RESULT,
      expected: {
        failures: 3,
        failure_rules: 2,
        needs_review: 1,
        needs_review_rules: 1,
        failures_by_severity: { serious: 2, critical: 1 },
      },
    },
    {
      name: "code_analysis" as const,
      id: "code/a",
      path: "/v1/inspect/analyze/code%2Fa",
      payload: CODE_ANALYSIS_RESULT,
      expected: { count: 2, instances: 3, by_feature: { "html-width": 2, "target-attribute": 1 } },
    },
  ])("keeps $name path and interpretation behind the shared seam", async (entry) => {
    const { deps, requests } = fakeDeps({
      [STATUS_PATH]: renderFor(entry.name, entry.id),
      [entry.path]: entry.payload,
    });
    const output = await collectEmailPreviewQa(
      { testId: "preview_test_001", timeoutMs: 30_000 },
      deps,
    );

    expect(requests).toContain(`GET ${entry.path}`);
    expect(output.checks[entry.name]).toMatchObject({
      status: "complete",
      result_id: entry.id,
      ...entry.expected,
    });
  });

  test.each([
    [RENDER_PARTIAL, "partial", 1, false, false],
    [RENDER_STRAGGLER, "processing", 0, true, false],
    [RENDER_EMPTY, "unknown", 0, false, true],
  ])(
    "normalizes client render state and gaps",
    async (render, status, bounced, hasIncompleteGap, hasUnavailableGap) => {
      const routes = render === RENDER_EMPTY ? {} : RESULT_ROUTES;
      const { deps } = fakeDeps({ [STATUS_PATH]: render, ...routes });
      const output = await collectEmailPreviewQa(
        { testId: "preview_test_001", timeoutMs: 0 },
        deps,
      );

      expect(output.status).toBe(status);
      expect(output.summary.bounced).toBe(bounced);
      const gapCodes = output.data_gaps.map(({ code }) => code);
      expect(gapCodes.includes("render_incomplete")).toBe(hasIncompleteGap);
      expect(gapCodes.includes("render_clients_unavailable")).toBe(hasUnavailableGap);
    },
  );

  test("reports unavailable and not-requested checks from one normalization pass", async () => {
    const { deps } = fakeDeps({
      [STATUS_PATH]: RENDER_CHECK_REFERENCE_MISSING,
      "/v1/inspect/links/link_010": LINK_RESULT,
      "/v1/inspect/analyze/code_013": CODE_ANALYSIS_RESULT,
    });
    const output = await collectEmailPreviewQa(
      { testId: "preview_test_001", timeoutMs: 30_000 },
      deps,
    );

    expect(output.checks.image_validation.status).toBe("unavailable");
    expect(output.checks.accessibility.status).toBe("not_requested");
    expect(output.data_gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "check_reference_missing" })]),
    );
  });

  test("polls a processing detail until the check completes", async () => {
    let codeCalls = 0;
    const { deps, requests } = fakeDeps({
      [STATUS_PATH]: RENDER_COMPLETE,
      ...RESULT_ROUTES,
      "/v1/inspect/analyze/code_001": () => {
        codeCalls += 1;
        return codeCalls === 1 ? CODE_ANALYSIS_PROCESSING : CODE_ANALYSIS_RESULT;
      },
    });
    const output = await collectEmailPreviewQa(
      { testId: "preview_test_001", timeoutMs: 10_000 },
      deps,
    );

    expect(output.checks.code_analysis.status).toBe("complete");
    expect(requests.filter((request) => request === `GET ${STATUS_PATH}`)).toHaveLength(2);
  });

  test("returns latest evidence and a gap when the workflow deadline expires", async () => {
    const { deps } = fakeDeps({
      [STATUS_PATH]: RENDER_COMPLETE,
      ...RESULT_ROUTES,
      "/v1/inspect/analyze/code_001": CODE_ANALYSIS_PROCESSING,
    });
    const output = await collectEmailPreviewQa({ testId: "preview_test_001", timeoutMs: 0 }, deps);

    expect(output.timed_out).toBe(true);
    expect(output.checks.code_analysis).toMatchObject({ status: "processing", count: 0 });
    expect(output.data_gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "workflow_timed_out" })]),
    );
  });

  test("turns a referenced result 404 into an unavailable check and data gap", async () => {
    const { deps } = fakeDeps({
      [STATUS_PATH]: RENDER_COMPLETE,
      ...RESULT_ROUTES,
      "/v1/inspect/analyze/code_001": undefined,
    });
    const output = await collectEmailPreviewQa(
      { testId: "preview_test_001", timeoutMs: 30_000 },
      deps,
    );

    expect(output.checks.code_analysis.status).toBe("unavailable");
    expect(output.data_gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "result_endpoint_unavailable" })]),
    );
  });

  test("reports requested clients missing from every render state", async () => {
    const { deps } = fakeDeps({ [STATUS_PATH]: RENDER_COMPLETE, ...RESULT_ROUTES });
    const output = await collectEmailPreviewQa(
      {
        testId: "preview_test_001",
        timeoutMs: 30_000,
        requestedClients: ["gmail_chrome", "missing_client"],
      },
      deps,
    );

    expect(output.data_gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "requested_client_missing" })]),
    );
  });

  test("reports a missing canonical code-analysis count without inventing one", async () => {
    const codeWithoutCount = {
      ...CODE_ANALYSIS_RESULT,
      meta: { ...CODE_ANALYSIS_RESULT.meta, count: undefined },
    };
    const { deps } = fakeDeps({
      [STATUS_PATH]: RENDER_COMPLETE,
      ...RESULT_ROUTES,
      "/v1/inspect/analyze/code_001": codeWithoutCount,
    });
    const output = await collectEmailPreviewQa(
      { testId: "preview_test_001", timeoutMs: 30_000 },
      deps,
    );

    expect(output.checks.code_analysis).toMatchObject({
      status: "complete",
      count: 0,
      instances: 3,
    });
    expect(output.data_gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "code_analysis_count_unavailable" }),
      ]),
    );
  });

  test("preserves native severity spelling while matching lifecycle case-insensitively", async () => {
    const mixedCase = {
      ...LINK_RESULT,
      meta: { status: "  COMPLETED  " },
      items: {
        ...LINK_RESULT.items,
        results: [
          {
            passes: [],
            informational: [],
            failures: [{ impact: " Major " }, { impact: "major" }, { impact: "" }],
          },
        ],
      },
    };
    const { deps } = fakeDeps({
      [STATUS_PATH]: renderFor("link_validation", "link_001"),
      "/v1/inspect/links/link_001": mixedCase,
    });
    const output = await collectEmailPreviewQa(
      { testId: "preview_test_001", timeoutMs: 30_000 },
      deps,
    );

    expect(output.checks.link_validation).toMatchObject({
      status: "complete",
      failures: 3,
      by_severity: { Major: 1, major: 1, unknown: 1 },
    });
  });
});
