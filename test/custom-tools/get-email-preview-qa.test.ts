import { describe, test, expect } from "vitest";
import { runGetEmailPreviewQa } from "../../src/custom-tools/get-email-preview-qa.js";
import { MailgunApiError } from "../../src/api.js";
import type { PollDeps } from "../../src/custom-tools/email-preview-qa.js";
import {
  RENDER_COMPLETE,
  RENDER_STRAGGLER,
  RENDER_CHECK_LIFECYCLE,
  LINK_RESULT,
  IMAGE_RESULT,
  ACCESSIBILITY_RESULT,
  CODE_ANALYSIS_RESULT,
  CODE_ANALYSIS_PROCESSING,
} from "../fixtures/email-preview-qa-contract.js";

type Route = unknown | (() => unknown);

// Deterministic deps: `sleep` advances a virtual clock so poll loops terminate
// without real timers, and `request` resolves fixtures (or throws) by path.
function fakeDeps(routes: Record<string, Route>): { deps: PollDeps; requests: string[] } {
  let current = 0;
  const requests: string[] = [];
  const deps: PollDeps = {
    request: async (method, path) => {
      requests.push(`${method} ${path}`);
      const route = routes[path];
      if (route === undefined) throw new MailgunApiError("not found", 404);
      return typeof route === "function" ? (route as () => unknown)() : route;
    },
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
  return { deps, requests };
}

const STATUS_PATH = "/v2/preview/tests/preview_test_001";
const RESULT_ROUTES = {
  "/v1/inspect/links/link_001": LINK_RESULT,
  "/v1/inspect/images/image_001": IMAGE_RESULT,
  "/v1/inspect/accessibility/access_001": ACCESSIBILITY_RESULT,
  "/v1/inspect/analyze/code_001": CODE_ANALYSIS_RESULT,
};

describe("runGetEmailPreviewQa", () => {
  test("complete render fetches every referenced result", async () => {
    const { deps, requests } = fakeDeps({ [STATUS_PATH]: RENDER_COMPLETE, ...RESULT_ROUTES });
    const output = await runGetEmailPreviewQa({ testId: "preview_test_001", timeoutSeconds: 30 }, deps);

    expect(output.status).toBe("complete");
    expect(output.timed_out).toBe(false);
    expect(output.checks.link_validation.status).toBe("complete");
    expect(output.checks.code_analysis.status).toBe("complete");
    expect(output.issue_counts.total).toBe(6);
    // All checks terminal on the first pass: one status fetch, no polling loop.
    expect(requests.filter((r) => r === `GET ${STATUS_PATH}`)).toHaveLength(1);
    expect(requests).toContain("GET /v1/inspect/analyze/code_001");
  });

  test("polls while a CHECK is still processing, then settles to complete", async () => {
    let analyzeCalls = 0;
    const { deps, requests } = fakeDeps({
      // Render is done immediately; the code-analysis CHECK lags, so polling is
      // driven by the check, not the render.
      [STATUS_PATH]: RENDER_COMPLETE,
      "/v1/inspect/links/link_001": LINK_RESULT,
      "/v1/inspect/images/image_001": IMAGE_RESULT,
      "/v1/inspect/accessibility/access_001": ACCESSIBILITY_RESULT,
      "/v1/inspect/analyze/code_001": () => {
        analyzeCalls += 1;
        return analyzeCalls >= 3 ? CODE_ANALYSIS_RESULT : CODE_ANALYSIS_PROCESSING;
      },
    });
    const output = await runGetEmailPreviewQa({ testId: "preview_test_001", timeoutSeconds: 60 }, deps);

    expect(output.status).toBe("complete");
    expect(output.timed_out).toBe(false);
    expect(output.checks.code_analysis.status).toBe("complete");
    expect(requests.filter((r) => r === `GET ${STATUS_PATH}`).length).toBeGreaterThanOrEqual(3);
  });

  test("a slow render client does NOT block; results return with render_incomplete", async () => {
    const { deps, requests } = fakeDeps({ [STATUS_PATH]: RENDER_STRAGGLER, ...RESULT_ROUTES });
    const output = await runGetEmailPreviewQa({ testId: "preview_test_001", timeoutSeconds: 30 }, deps);

    expect(output.timed_out).toBe(false);
    expect(output.checks.link_validation.status).toBe("complete");
    expect(output.summary.processing).toBe(1);
    expect(output.data_gaps.map((g) => g.code)).toContain("render_incomplete");
    // Only one status fetch: checks were terminal despite the render straggler.
    expect(requests.filter((r) => r === `GET ${STATUS_PATH}`)).toHaveLength(1);
  });

  test("times out when a CHECK never settles (render is irrelevant)", async () => {
    const { deps } = fakeDeps({
      [STATUS_PATH]: RENDER_COMPLETE,
      "/v1/inspect/links/link_001": LINK_RESULT,
      "/v1/inspect/images/image_001": IMAGE_RESULT,
      "/v1/inspect/accessibility/access_001": ACCESSIBILITY_RESULT,
      "/v1/inspect/analyze/code_001": CODE_ANALYSIS_PROCESSING,
    });
    const output = await runGetEmailPreviewQa({ testId: "preview_test_001", timeoutSeconds: 10 }, deps);

    expect(output.timed_out).toBe(true);
    expect(output.checks.code_analysis.status).toBe("processing");
    // Other checks still resolve; they are not held back by the lagging one.
    expect(output.checks.link_validation.status).toBe("complete");
    expect(output.data_gaps.map((g) => g.code)).toContain("workflow_timed_out");
  });

  test("unexpected 404 on a result endpoint marks the check unavailable", async () => {
    // RENDER_CHECK_LIFECYCLE references code_pending (not in routes -> 404),
    // link_001 resolves, image job failed, accessibility not requested.
    const { deps } = fakeDeps({
      [STATUS_PATH]: RENDER_CHECK_LIFECYCLE,
      "/v1/inspect/links/link_001": LINK_RESULT,
    });
    const output = await runGetEmailPreviewQa({ testId: "preview_test_001", timeoutSeconds: 30 }, deps);

    expect(output.checks.link_validation.status).toBe("complete");
    expect(output.checks.image_validation.status).toBe("job_failed");
    expect(output.checks.accessibility.status).toBe("not_requested");
    expect(output.checks.code_analysis.status).toBe("unavailable");
    expect(output.data_gaps.map((g) => g.code)).toContain("result_endpoint_unavailable");
  });
});
