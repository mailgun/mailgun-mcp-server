import { describe, test, expect } from "vitest";
import {
  normalizeRenderState,
  extractCheckResultIds,
  checkResultPath,
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
  RENDER_EMPTY,
  RENDER_CHECK_LIFECYCLE,
  RENDER_CHECK_REFERENCE_MISSING,
  LINK_RESULT,
  IMAGE_RESULT,
  ACCESSIBILITY_RESULT,
  CODE_ANALYSIS_RESULT,
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
    expect(refs.code_analysis.resultId).toBe("preview_test_001");
  });

  test("lifecycle render distinguishes job_failed, not_requested, and missing refs", () => {
    const refs = extractCheckResultIds(RENDER_CHECK_LIFECYCLE);
    expect(refs.link_validation.resultId).toBe("link_001");
    expect(refs.image_validation).toEqual({ requested: true, hasErrors: true, resultId: null });
    expect(refs.accessibility).toEqual({ requested: false, hasErrors: false, resultId: null });
    expect(refs.code_analysis.resultId).toBe("analyze_pending");
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

describe("normalizeCheckLifecycle", () => {
  const requested: CheckReference = { requested: true, hasErrors: false, resultId: "x" };
  test("not requested", () => {
    expect(
      normalizeCheckLifecycle({ requested: false, hasErrors: false, resultId: null }, { status: "not_fetched" }, true),
    ).toBe("not_requested");
  });
  test("job failed", () => {
    expect(
      normalizeCheckLifecycle({ requested: true, hasErrors: true, resultId: null }, { status: "not_fetched" }, true),
    ).toBe("job_failed");
  });
  test("complete when fetched ok", () => {
    expect(normalizeCheckLifecycle(requested, { status: "ok", payload: {} }, true)).toBe("complete");
  });
  test("unavailable on 404", () => {
    expect(normalizeCheckLifecycle(requested, { status: "not_found" }, true)).toBe("unavailable");
  });
  test("processing when render unsettled and not yet fetched", () => {
    expect(normalizeCheckLifecycle(requested, { status: "not_fetched" }, false)).toBe("processing");
  });
  test("missing result id is unavailable", () => {
    expect(
      normalizeCheckLifecycle({ requested: true, hasErrors: false, resultId: null }, { status: "not_fetched" }, true),
    ).toBe("unavailable");
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

  test("accessibility keeps failures and needs_review separate", () => {
    const c = countAccessibilityIssues(ACCESSIBILITY_RESULT);
    expect(c.failures).toBe(2);
    expect(c.needs_review).toBe(1);
    expect(c.failures_by_severity).toEqual({ serious: 1, critical: 1 });
    expect(c.needs_review_by_severity).toEqual({ moderate: 1 });
  });

  test("code analysis counts instances/support and flags an unconfirmed formula", () => {
    const c = countCodeAnalysisIssues(CODE_ANALYSIS_RESULT);
    expect(c.issues).toBe(3);
    expect(c.by_feature).toEqual({ "font-size": 2, "target-attribute": 1 });
    expect(c.by_support_type).toEqual({ y: 3, a: 1, n: 2, u: 1 });
    expect(c.by_client).toEqual({ outlook_win: 2, lotus_notes: 1 });
    expect(c.by_application).toEqual({});
    expect(c.formula_unconfirmed).toBe(true);
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
    expect(output.checks.accessibility.needs_review).toBe(1);
    expect(output.issue_counts.total).toBe(5);
    expect(output.issue_counts.by_check).toEqual({
      link_validation: 2,
      image_validation: 1,
      accessibility: 2,
    });
    expect(output.issue_counts.by_severity).toEqual({ critical: 2, unknown: 1, moderate: 1, serious: 1 });
    expect(output.data_gaps.map((g) => g.code)).toContain("code_analysis_count_formula_unsupported");
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

  test("timeout adds a workflow_timed_out data gap", () => {
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
