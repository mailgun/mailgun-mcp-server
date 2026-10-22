import { describe, test, expect } from "vitest";
import {
  validateRunInput,
  runCreateAndPoll,
  RunEmailPreviewQaError,
  MAX_HTML_BYTES,
} from "../../src/custom-tools/run-email-preview-qa.js";
import { buildPreviewCreateRequest } from "../../src/custom-tools/email-preview-qa.js";
import { MailgunApiError } from "../../src/api.js";
import type { PollDeps } from "../../src/custom-tools/email-preview-qa.js";
import {
  CREATE_ALL_CHECKS,
  CREATE_INVALID_CLIENT_WARNINGS,
  CREATE_MISSING_TEST_ID,
  RENDER_COMPLETE,
  LINK_RESULT,
  IMAGE_RESULT,
  ACCESSIBILITY_RESULT,
  CODE_ANALYSIS_RESULT,
  CODE_ANALYSIS_PROCESSING,
} from "../fixtures/email-preview-qa-contract.js";

const CREATE_PATH = "/v2/preview/tests";
const STATUS_PATH = "/v2/preview/tests/preview_test_001";
const RESULT_ROUTES: Record<string, unknown> = {
  "/v1/inspect/links/link_001": LINK_RESULT,
  "/v1/inspect/images/image_001": IMAGE_RESULT,
  "/v1/inspect/accessibility/access_001": ACCESSIBILITY_RESULT,
  "/v1/inspect/analyze/code_001": CODE_ANALYSIS_RESULT,
};

interface FakeOpts {
  createResponse?: unknown;
  createLatencyMs?: number;
  createError?: unknown;
  status?: unknown | (() => unknown);
  resultRoutes?: Record<string, unknown>;
}

function fakeDeps(opts: FakeOpts): {
  deps: PollDeps;
  posts: { path: string; body: unknown }[];
  gets: string[];
} {
  let current = 0;
  const posts: { path: string; body: unknown }[] = [];
  const gets: string[] = [];
  const deps: PollDeps = {
    request: async (method, path, body) => {
      if (method === "POST") {
        posts.push({ path, body });
        current += opts.createLatencyMs ?? 0;
        if (opts.createError !== undefined) throw opts.createError;
        return opts.createResponse;
      }
      gets.push(path);
      if (path === STATUS_PATH) {
        return typeof opts.status === "function" ? (opts.status as () => unknown)() : opts.status;
      }
      const routes = opts.resultRoutes ?? RESULT_ROUTES;
      const route = routes[path];
      if (route === undefined) throw new MailgunApiError("not found", 404);
      return route;
    },
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
  return { deps, posts, gets };
}

const baseInput = { subject: "June campaign", html: "<h1>Hi</h1>", contentChecks: undefined };

describe("validateRunInput", () => {
  test("rejects a blank subject", () => {
    expect(() => validateRunInput({ subject: "  ", html: "<p>x</p>" })).toThrow(
      RunEmailPreviewQaError,
    );
  });

  test("rejects empty html", () => {
    expect(() => validateRunInput({ subject: "s", html: "" })).toThrow(/HTML/);
  });

  test("rejects an explicitly empty clients list", () => {
    expect(() => validateRunInput({ subject: "s", html: "<p>x</p>", clients: [] })).toThrow(
      /clients/,
    );
  });

  test("dedupes clients and defaults all four checks", () => {
    const v = validateRunInput({ subject: "s", html: "<p>x</p>", clients: ["a", "a", "b"] });
    expect(v.clients).toEqual(["a", "b"]);
    expect(v.contentChecks).toEqual([
      "link_validation",
      "image_validation",
      "accessibility",
      "code_analysis",
    ]);
  });

  test("empty content checks means no checks", () => {
    const v = validateRunInput({ subject: "s", html: "<p>x</p>", contentChecks: [] });
    expect(v.contentChecks).toEqual([]);
  });

  describe("HTML size limit", () => {
    test("accepts HTML exactly at the 5 MiB limit", () => {
      // ASCII, so one byte per character: exactly MAX_HTML_BYTES bytes.
      const html = "a".repeat(MAX_HTML_BYTES);
      const v = validateRunInput({ subject: "s", html });
      expect(Buffer.byteLength(v.html, "utf8")).toBe(MAX_HTML_BYTES);
    });

    test("rejects HTML one byte over the limit", () => {
      const html = "a".repeat(MAX_HTML_BYTES + 1);
      expect(() => validateRunInput({ subject: "s", html })).toThrow(/HTML_TOO_LARGE|exceeds/);
    });

    test("counts UTF-8 bytes, not characters, and rejects with zero requests", async () => {
      // A two-byte character exceeds the byte limit without exceeding the character limit.
      const html = "é".repeat(MAX_HTML_BYTES / 2 + 1);
      const { deps, posts, gets } = fakeDeps({
        createResponse: CREATE_ALL_CHECKS,
        status: RENDER_COMPLETE,
      });
      expect(() => validateRunInput({ subject: "s", html })).toThrow(RunEmailPreviewQaError);
      expect(posts).toHaveLength(0);
      expect(gets).toHaveLength(0);
      expect(deps.request).toBeTypeOf("function");
    });
  });

  test("rejects a blank client id instead of silently dropping it", () => {
    expect(() =>
      validateRunInput({ subject: "s", html: "<p>x</p>", clients: ["gmail_chrome", "  "] }),
    ).toThrow(/blank or invalid/);
  });

  test("passes valid client ids through unchanged (exact-string dedupe, no trimming)", () => {
    const v = validateRunInput({
      subject: "s",
      html: "<p>x</p>",
      clients: [" spaced ", " spaced ", "b"],
    });
    expect(v.clients).toEqual([" spaced ", "b"]);
  });

  describe("timeout contract", () => {
    test("defaults to 45", () => {
      expect(validateRunInput({ subject: "s", html: "<p>x</p>" }).timeoutSeconds).toBe(45);
    });
    test("accepts 0 and 45", () => {
      expect(
        validateRunInput({ subject: "s", html: "<p>x</p>", timeoutSeconds: 0 }).timeoutSeconds,
      ).toBe(0);
      expect(
        validateRunInput({ subject: "s", html: "<p>x</p>", timeoutSeconds: 45 }).timeoutSeconds,
      ).toBe(45);
    });
    test.each([-1, 46, 120, 300, 1.5])("rejects invalid value %s", (value) => {
      expect(() =>
        validateRunInput({ subject: "s", html: "<p>x</p>", timeoutSeconds: value }),
      ).toThrow(RunEmailPreviewQaError);
    });
    test("a rejected timeout makes zero requests", async () => {
      const { deps, posts, gets } = fakeDeps({
        createResponse: CREATE_ALL_CHECKS,
        status: RENDER_COMPLETE,
      });
      // Validation prevents the workflow from receiving deps.
      expect(() => validateRunInput({ ...baseInput, timeoutSeconds: -1 })).toThrow(
        RunEmailPreviewQaError,
      );
      expect(posts).toHaveLength(0);
      expect(gets).toHaveLength(0);
      // Guard against an unused-deps lint by referencing deps.
      expect(deps.request).toBeTypeOf("function");
    });
  });
});

describe("buildPreviewCreateRequest", () => {
  test("omits clients/reference_id when absent and sends explicit check booleans", () => {
    const body = buildPreviewCreateRequest({ subject: "s", html: "<p>x</p>" });
    expect(body.clients).toBeUndefined();
    expect(body.reference_id).toBeUndefined();
    expect(body.content_checking).toEqual({
      link_validation: true,
      image_validation: true,
      accessibility: true,
      code_analysis: true,
    });
  });

  test("includes clients + reference_id and disables unrequested checks", () => {
    const body = buildPreviewCreateRequest({
      subject: "s",
      html: "<p>x</p>",
      clients: ["gmail_chrome"],
      contentChecks: ["link_validation"],
      referenceId: "ref-1",
    });
    expect(body.clients).toEqual(["gmail_chrome"]);
    expect(body.reference_id).toBe("ref-1");
    expect(body.content_checking).toEqual({
      link_validation: true,
      image_validation: false,
      accessibility: false,
      code_analysis: false,
    });
  });
});

describe("runCreateAndPoll", () => {
  test("creates exactly once, then polls and summarizes", async () => {
    const { deps, posts, gets } = fakeDeps({
      createResponse: CREATE_ALL_CHECKS,
      status: RENDER_COMPLETE,
    });
    const output = await runCreateAndPoll(validateRunInput(baseInput), deps);

    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(CREATE_PATH);
    expect(output.status).toBe("complete");
    expect(output.issue_counts.total).toBe(6);
    expect(gets).toContain("/v1/inspect/analyze/code_001");
  });

  test("surfaces upstream invalid-client warnings", async () => {
    const create = { ...CREATE_INVALID_CLIENT_WARNINGS, id: "preview_test_001" };
    const { deps } = fakeDeps({ createResponse: create, status: RENDER_COMPLETE });
    const output = await runCreateAndPoll(validateRunInput(baseInput), deps);
    expect(output.warnings).toHaveLength(2);
    expect(output.warnings[0]?.message).toMatch(/Unknown client/);
  });

  test("create response without a test id errors and never polls", async () => {
    const { deps, posts, gets } = fakeDeps({
      createResponse: CREATE_MISSING_TEST_ID,
      status: RENDER_COMPLETE,
    });
    await expect(runCreateAndPoll(validateRunInput(baseInput), deps)).rejects.toMatchObject({
      code: "CREATE_NO_TEST_ID",
    });
    expect(posts).toHaveLength(1);
    expect(gets).toHaveLength(0);
  });

  test("ambiguous transport failure is not retryable and posts exactly once", async () => {
    const { deps, posts, gets } = fakeDeps({ createError: new Error("socket hang up") });
    const error = await runCreateAndPoll(
      validateRunInput({ ...baseInput, referenceId: "lovable-build-123" }),
      deps,
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "AMBIGUOUS_CREATE",
      retryable: false,
      referenceId: "lovable-build-123",
    });
    // Upstream drops reference_id, so the hint reconciles by subject and a create-time window.
    const details = (error as RunEmailPreviewQaError).details;
    expect(details).toContain("subject 'June campaign'");
    expect(details).toMatch(/from \d+ to \d+ as Unix timestamps/);
    expect(details).not.toContain("reference_id");
    expect(posts).toHaveLength(1);
    expect(gets).toHaveLength(0);
  });

  test.each([401, 403])("a %s create rejection is reported as not entitled", async (statusCode) => {
    const { deps, posts } = fakeDeps({
      createError: new MailgunApiError("forbidden", statusCode, "not enabled"),
    });
    await expect(runCreateAndPoll(validateRunInput(baseInput), deps)).rejects.toMatchObject({
      code: "NOT_ENTITLED",
      retryable: false,
    });
    expect(posts).toHaveLength(1);
  });

  test.each([400, 404, 429])(
    "a %s create rejection is not retryable, posts once, and still asks to reconcile",
    async (statusCode) => {
      const { deps, posts } = fakeDeps({
        createError: new MailgunApiError("rejected", statusCode, "nope"),
      });
      // Upstream can return 400 after the test already exists, so even rejections reconcile.
      await expect(runCreateAndPoll(validateRunInput(baseInput), deps)).rejects.toMatchObject({
        code: "CREATE_REJECTED",
        retryable: false,
        details: expect.stringContaining("list_preview_tests"),
      });
      expect(posts).toHaveLength(1);
    },
  );

  test.each([500, 502, 503, 504])(
    "a %s create response is ambiguous and posts exactly once",
    async (statusCode) => {
      const { deps, posts } = fakeDeps({
        createError: new MailgunApiError("gateway", statusCode, "upstream"),
      });
      await expect(runCreateAndPoll(validateRunInput(baseInput), deps)).rejects.toMatchObject({
        code: "AMBIGUOUS_CREATE",
        retryable: false,
      });
      expect(posts).toHaveLength(1);
    },
  );

  test("a poll failure after a successful create is not retryable and points to the resume tool", async () => {
    // Create succeeds; the status GET throws a non-404 error the poll propagates.
    const { deps, posts } = fakeDeps({
      createResponse: CREATE_ALL_CHECKS,
      status: () => {
        throw new MailgunApiError("boom", 500, "server error");
      },
    });
    await expect(runCreateAndPoll(validateRunInput(baseInput), deps)).rejects.toMatchObject({
      code: "POLL_FAILED_AFTER_CREATE",
      retryable: false,
      testId: "preview_test_001",
    });
    expect(posts).toHaveLength(1);
  });

  test("a normalization failure after create still points at the created test", async () => {
    // Anything that escapes here would surface as a retryable error and invite a second create.
    const normalizationFailure = new Error("normalization failed");
    const linkResult = new Proxy(LINK_RESULT, {
      get(target, property, receiver) {
        if (property === "items") throw normalizationFailure;
        return Reflect.get(target, property, receiver);
      },
    });
    const { deps, posts } = fakeDeps({
      createResponse: CREATE_ALL_CHECKS,
      status: RENDER_COMPLETE,
      resultRoutes: { ...RESULT_ROUTES, "/v1/inspect/links/link_001": linkResult },
    });

    await expect(runCreateAndPoll(validateRunInput(baseInput), deps)).rejects.toMatchObject({
      code: "POLL_FAILED_AFTER_CREATE",
      retryable: false,
      testId: "preview_test_001",
      details: expect.stringContaining("normalization failed"),
    });
    expect(posts).toHaveLength(1);
  });

  test("a requested check omitted from the status is terminal, not pending", async () => {
    // Upstream omits link_validation when the HTML has no links and never adds it later.
    const contentChecking: Record<string, unknown> = { ...RENDER_COMPLETE.content_checking };
    delete contentChecking.link_validation;
    const renderWithoutLinks = { ...RENDER_COMPLETE, content_checking: contentChecking };
    const { deps, posts, gets } = fakeDeps({
      createResponse: CREATE_ALL_CHECKS,
      status: renderWithoutLinks,
    });
    const output = await runCreateAndPoll(validateRunInput(baseInput), deps);

    expect(output.timed_out).toBe(false);
    expect(output.checks.link_validation.status).toBe("unavailable");
    expect(output.checks.image_validation.status).toBe("complete");
    expect(output.data_gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "check_not_run" })]),
    );
    expect(gets.filter((g) => g === STATUS_PATH)).toHaveLength(1);
    expect(posts).toHaveLength(1);
  });

  test("an explicit empty content_checks selection terminates after one status read", async () => {
    // With no checks requested, the render exposes no content_checking nodes.
    const renderNoChecks = {
      completed: ["gmail_chrome"],
      processing: [],
      bounced: [],
      content_checking: {},
    };
    const { deps, posts, gets } = fakeDeps({
      createResponse: CREATE_ALL_CHECKS,
      status: renderNoChecks,
    });
    const output = await runCreateAndPoll(
      validateRunInput({ ...baseInput, contentChecks: [] }),
      deps,
    );
    // No checks requested -> all not_requested -> terminal immediately, no result fetches.
    expect(output.checks.link_validation.status).toBe("not_requested");
    expect(gets.filter((g) => g === STATUS_PATH)).toHaveLength(1);
    expect(gets.some((g) => g.startsWith("/v1/inspect/"))).toBe(false);
    expect(posts).toHaveLength(1);
  });

  test("timeout when a check never settles returns partial results, never a second create", async () => {
    // Processing code analysis times out after rendering completes without another POST.
    const { deps, posts } = fakeDeps({
      createResponse: CREATE_ALL_CHECKS,
      status: RENDER_COMPLETE,
      resultRoutes: {
        "/v1/inspect/links/link_001": LINK_RESULT,
        "/v1/inspect/images/image_001": IMAGE_RESULT,
        "/v1/inspect/accessibility/access_001": ACCESSIBILITY_RESULT,
        "/v1/inspect/analyze/code_001": CODE_ANALYSIS_PROCESSING,
      },
    });
    const output = await runCreateAndPoll(
      validateRunInput({ ...baseInput, timeoutSeconds: 10 }),
      deps,
    );
    expect(output.timed_out).toBe(true);
    expect(output.checks.code_analysis.status).toBe("processing");
    expect(output.checks.link_validation.status).toBe("complete");
    expect(posts).toHaveLength(1);
    expect(output.data_gaps.map((g) => g.code)).toContain("workflow_timed_out");
  });

  test("time spent creating counts against the timeout", async () => {
    const { deps, gets } = fakeDeps({
      createResponse: CREATE_ALL_CHECKS,
      createLatencyMs: 8_000,
      status: RENDER_COMPLETE,
      resultRoutes: {
        ...RESULT_ROUTES,
        "/v1/inspect/analyze/code_001": CODE_ANALYSIS_PROCESSING,
      },
    });
    const output = await runCreateAndPoll(
      validateRunInput({ ...baseInput, timeoutSeconds: 10 }),
      deps,
    );
    expect(output.timed_out).toBe(true);
    expect(gets.filter((g) => g === STATUS_PATH)).toHaveLength(1);
  });
});
