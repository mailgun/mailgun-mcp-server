import { describe, test, expect } from "vitest";
import {
  normalizeRenderState,
  extractCheckResultIds,
  checkResultPath,
  detailStatus,
  isCheckTerminal,
  normalizeCheckLifecycle,
  countLinkValidationIssues,
  countImageValidationIssues,
  countAccessibilityIssues,
  countCodeAnalysisIssues,
  buildEmailPreviewQaOutput,
  type CheckReference,
  type CheckFetch,
  type CheckName,
} from "../../src/custom-tools/email-preview-qa.js";
import {
  RENDER_COMPLETE,
  RENDER_PROCESSING,
  RENDER_PARTIAL,
  RENDER_STRAGGLER,
  RENDER_EMPTY,
  RENDER_CHECK_LIFECYCLE,
  RENDER_CHECK_REFERENCE_MISSING,
  LINK_RESULT,
  IMAGE_RESULT,
  ACCESSIBILITY_RESULT,
  CODE_ANALYSIS_RESULT,
  CODE_ANALYSIS_PROCESSING,
} from "../fixtures/email-preview-qa-contract.js";

describe("normalizeRenderState", () => {
  test("complete render", () => {
    const s = normalizeRenderState(RENDER_COMPLETE);
    expect(s.status).toBe("complete");
    expect(s.completed).toHaveLength(3);
    expect(s.processing).toHaveLength(0);
    expect(s.bounced).toHaveLength(0);
  });

  test("processing render", () => {
    expect(normalizeRenderState(RENDER_PROCESSING).status).toBe("processing");
  });

  test("partial render (a client bounced)", () => {
    const s = normalizeRenderState(RENDER_PARTIAL);
    expect(s.status).toBe("partial");
    expect(s.bounced).toEqual(["lotus_notes"]);
  });

  test("empty render is unknown", () => {
    expect(normalizeRenderState(RENDER_EMPTY).status).toBe("unknown");
  });
});

describe("extractCheckResultIds", () => {
  test("all-checks render exposes every result id", () => {
    const refs = extractCheckResultIds(RENDER_COMPLETE);
    expect(refs.link_validation).toEqual({ requested: true, hasErrors: false, resultId: "link_001" });
    expect(refs.code_analysis.resultId).toBe("code_001");
  });

  test("lifecycle render distinguishes job_failed, not_requested, and missing refs", () => {
    const refs = extractCheckResultIds(RENDER_CHECK_LIFECYCLE);
    expect(refs.link_validation.resultId).toBe("link_001");
    expect(refs.image_validation).toEqual({ requested: true, hasErrors: true, resultId: null });
    expect(refs.accessibility).toEqual({ requested: false, hasErrors: false, resultId: null });
    expect(refs.code_analysis.resultId).toBe("code_pending");
  });

  test("missing reference is requested with a null result id", () => {
    const refs = extractCheckResultIds(RENDER_CHECK_REFERENCE_MISSING);
    expect(refs.image_validation).toEqual({ requested: true, hasErrors: false, resultId: null });
    expect(refs.accessibility.requested).toBe(false);
  });
});

describe("checkResultPath builds allowlisted paths", () => {
  test.each([
    ["link_validation", "/v1/inspect/links/abc"],
    ["image_validation", "/v1/inspect/images/abc"],
    ["accessibility", "/v1/inspect/accessibility/abc"],
    ["code_analysis", "/v1/inspect/analyze/abc"],
  ] as [CheckName, string][])("%s", (name, expected) => {
    expect(checkResultPath(name, "abc")).toBe(expected);
  });
});

describe("detailStatus reads the check's own meta.status (case-insensitive)", () => {
  test("Completed / Complete are complete", () => {
    expect(detailStatus(LINK_RESULT)).toBe("complete");
    expect(detailStatus(IMAGE_RESULT)).toBe("complete");
  });
  test("Processing is processing", () => {
    expect(detailStatus(CODE_ANALYSIS_PROCESSING)).toBe("processing");
  });
  test("missing meta is treated as complete (payload materialized)", () => {
    expect(detailStatus({})).toBe("complete");
  });
});

describe("isCheckTerminal drives polling independently of render", () => {
  const ref: CheckReference = { requested: true, hasErrors: false, resultId: "x" };
  test("complete detail payload is terminal", () => {
    expect(isCheckTerminal(ref, { status: "ok", payload: LINK_RESULT })).toBe(true);
  });
  test("processing detail payload is not terminal", () => {
    expect(isCheckTerminal(ref, { status: "ok", payload: CODE_ANALYSIS_PROCESSING })).toBe(false);
  });
  test("not requested is terminal; missing reference is not", () => {
    expect(isCheckTerminal({ requested: false, hasErrors: false, resultId: null }, { status: "not_fetched" })).toBe(true);
    expect(isCheckTerminal({ requested: true, hasErrors: false, resultId: null }, { status: "not_fetched" })).toBe(false);
  });
});

describe("normalizeCheckLifecycle", () => {
  const requested: CheckReference = { requested: true, hasErrors: false, resultId: "x" };
  test("not requested", () => {
    expect(
      normalizeCheckLifecycle({ requested: false, hasErrors: false, resultId: null }, { status: "not_fetched" }, false),
    ).toBe("not_requested");
  });
  test("job failed", () => {
    expect(
      normalizeCheckLifecycle({ requested: true, hasErrors: true, resultId: null }, { status: "not_fetched" }, false),
    ).toBe("job_failed");
  });
  test("complete when fetched ok and detail is complete", () => {
    expect(normalizeCheckLifecycle(requested, { status: "ok", payload: LINK_RESULT }, false)).toBe("complete");
  });
  test("processing when fetched ok but detail still processing", () => {
    expect(normalizeCheckLifecycle(requested, { status: "ok", payload: CODE_ANALYSIS_PROCESSING }, false)).toBe("processing");
  });
  test("unavailable on 404", () => {
    expect(normalizeCheckLifecycle(requested, { status: "not_found" }, false)).toBe("unavailable");
  });
  test("processing when referenced but not fetched by the deadline", () => {
    expect(normalizeCheckLifecycle(requested, { status: "not_fetched" }, false)).toBe("processing");
  });
  test("missing result id: unavailable normally, processing at a timeout", () => {
    const missing: CheckReference = { requested: true, hasErrors: false, resultId: null };
    expect(normalizeCheckLifecycle(missing, { status: "not_fetched" }, false)).toBe("unavailable");
    expect(normalizeCheckLifecycle(missing, { status: "not_fetched" }, true)).toBe("processing");
  });
});

describe("issue counters trace to V2 fields", () => {
  test("link validation", () => {
    const c = countLinkValidationIssues(LINK_RESULT);
    expect(c.passes).toBe(2);
    expect(c.failures).toBe(2);
    expect(c.informational).toBe(1);
    expect(c.by_severity).toEqual({ critical: 1, unknown: 1 });
  });

  test("image validation", () => {
    const c = countImageValidationIssues(IMAGE_RESULT);
    expect(c.passes).toBe(1);
    expect(c.failures).toBe(1);
    expect(c.informational).toBe(1);
    expect(c.by_severity).toEqual({ moderate: 1 });
  });

  test("accessibility counts instances (headline) and rules (secondary)", () => {
    const c = countAccessibilityIssues(ACCESSIBILITY_RESULT);
    expect(c.failures).toBe(3);
    expect(c.failure_rules).toBe(2);
    expect(c.needs_review).toBe(1);
    expect(c.needs_review_rules).toBe(1);
    expect(c.failures_by_severity).toEqual({ serious: 2, critical: 1 });
    expect(c.needs_review_by_severity).toEqual({ moderate: 1 });
  });

  test("code analysis uses meta.count and passes support aggregates through", () => {
    const c = countCodeAnalysisIssues(CODE_ANALYSIS_RESULT);
    expect(c.count).toBe(2);
    expect(c.instances).toBe(3);
    expect(c.by_feature).toEqual({ "html-width": 2, "target-attribute": 1 });
    expect(c.application_support).toEqual(CODE_ANALYSIS_RESULT.meta.application_support);
    expect(c.inbox_provider_support).toEqual(CODE_ANALYSIS_RESULT.meta.inbox_provider_support);
    expect(c.market_support).toEqual(CODE_ANALYSIS_RESULT.meta.market_support);
  });
});

describe("buildEmailPreviewQaOutput", () => {
  const okFetch = (payload: unknown): CheckFetch => ({ status: "ok", payload });

  test("complete render with all checks aggregates counts and references", () => {
    const refs = extractCheckResultIds(RENDER_COMPLETE);
    const output = buildEmailPreviewQaOutput({
      testId: "preview_test_001",
      render: RENDER_COMPLETE,
      refs,
      fetches: {
        link_validation: okFetch(LINK_RESULT),
        image_validation: okFetch(IMAGE_RESULT),
        accessibility: okFetch(ACCESSIBILITY_RESULT),
        code_analysis: okFetch(CODE_ANALYSIS_RESULT),
      },
      timedOut: false,
    });

    expect(output.status).toBe("complete");
    expect(output.timed_out).toBe(false);
    expect(output.summary).toEqual({ total_clients: 3, completed: 3, processing: 0, bounced: 0 });
    expect(output.checks.link_validation.status).toBe("complete");
    expect(output.checks.link_validation.result_id).toBe("link_001");
    expect(output.checks.accessibility.failures).toBe(3);
    expect(output.checks.accessibility.needs_review).toBe(1);
    expect(output.checks.code_analysis.count).toBe(2);
    expect(output.checks.code_analysis.instances).toBe(3);
    expect(output.issue_counts.total).toBe(6);
    expect(output.issue_counts.by_check).toEqual({
      link_validation: 2,
      image_validation: 1,
      accessibility: 3,
    });
    expect(output.issue_counts.by_severity).toEqual({ critical: 2, unknown: 1, moderate: 1, serious: 2 });
    // The code-analysis formula gate is resolved (meta.count); no such data gap.
    expect(output.data_gaps.map((g) => g.code)).not.toContain("code_analysis_count_formula_unsupported");
    expect(output.data_gaps).toHaveLength(0);
  });

  test("render straggler does not block; reported as render_incomplete", () => {
    const refs = extractCheckResultIds(RENDER_STRAGGLER);
    const output = buildEmailPreviewQaOutput({
      testId: "preview_test_001",
      render: RENDER_STRAGGLER,
      refs,
      fetches: {
        link_validation: okFetch(LINK_RESULT),
        image_validation: okFetch(IMAGE_RESULT),
        accessibility: okFetch(ACCESSIBILITY_RESULT),
        code_analysis: okFetch(CODE_ANALYSIS_RESULT),
      },
      timedOut: false,
    });
    expect(output.timed_out).toBe(false);
    expect(output.summary.processing).toBe(1);
    expect(output.checks.link_validation.status).toBe("complete");
    expect(output.data_gaps.map((g) => g.code)).toContain("render_incomplete");
    expect(output.data_gaps.map((g) => g.code)).not.toContain("workflow_timed_out");
  });

  test("missing reference yields unavailable lifecycle + data gap", () => {
    const refs = extractCheckResultIds(RENDER_CHECK_REFERENCE_MISSING);
    const output = buildEmailPreviewQaOutput({
      testId: "preview_test_013",
      render: RENDER_CHECK_REFERENCE_MISSING,
      refs,
      fetches: {
        link_validation: okFetch(LINK_RESULT),
        image_validation: { status: "not_fetched" },
        accessibility: { status: "not_fetched" },
        code_analysis: okFetch(CODE_ANALYSIS_RESULT),
      },
      timedOut: false,
    });
    expect(output.checks.image_validation.status).toBe("unavailable");
    expect(output.checks.accessibility.status).toBe("not_requested");
    expect(output.data_gaps.map((g) => g.code)).toContain("check_reference_missing");
  });

  test("timeout (a check never settled) adds workflow_timed_out", () => {
    const refs = extractCheckResultIds(RENDER_PROCESSING);
    const output = buildEmailPreviewQaOutput({
      testId: "preview_test_005",
      render: RENDER_PROCESSING,
      refs,
      fetches: {
        link_validation: { status: "not_fetched" },
        image_validation: { status: "not_fetched" },
        accessibility: { status: "not_fetched" },
        code_analysis: { status: "not_fetched" },
      },
      timedOut: true,
    });
    expect(output.status).toBe("processing");
    expect(output.timed_out).toBe(true);
    expect(output.checks.link_validation.status).toBe("processing");
    expect(output.data_gaps.map((g) => g.code)).toContain("workflow_timed_out");
  });
});
