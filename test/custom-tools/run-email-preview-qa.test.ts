import { describe, test, expect } from "vitest";
import {
  validateRunInput,
  runCreateAndPoll,
  RunEmailPreviewQaError,
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
    expect(() => validateRunInput({ subject: "  ", html: "<p>x</p>" })).toThrow(RunEmailPreviewQaError);
  });

  test("rejects empty html", () => {
    expect(() => validateRunInput({ subject: "s", html: "" })).toThrow(/HTML/);
  });

  test("rejects an explicitly empty clients list", () => {
    expect(() => validateRunInput({ subject: "s", html: "<p>x</p>", clients: [] })).toThrow(/clients/);
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

  test("clamps timeout to the 300s maximum", () => {
    expect(validateRunInput({ subject: "s", html: "<p>x</p>", timeoutSeconds: 9000 }).timeoutSeconds).toBe(300);
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
    const { deps, posts, gets } = fakeDeps({ createResponse: CREATE_ALL_CHECKS, status: RENDER_COMPLETE });
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
    const { deps, posts, gets } = fakeDeps({ createResponse: CREATE_MISSING_TEST_ID, status: RENDER_COMPLETE });
    await expect(runCreateAndPoll(validateRunInput(baseInput), deps)).rejects.toMatchObject({
      code: "CREATE_NO_TEST_ID",
    });
    expect(posts).toHaveLength(1);
    expect(gets).toHaveLength(0);
  });

  test("ambiguous transport failure is not retried", async () => {
    const { deps, posts, gets } = fakeDeps({ createError: new Error("socket hang up") });
    await expect(
      runCreateAndPoll(validateRunInput({ ...baseInput, referenceId: "lovable-build-123" }), deps),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_CREATE", retryable: true, referenceId: "lovable-build-123" });
    expect(posts).toHaveLength(1);
    expect(gets).toHaveLength(0);
  });

  test("a definitive 403 create rejection is reported and not retried", async () => {
    const { deps, posts } = fakeDeps({ createError: new MailgunApiError("forbidden", 403, "not enabled") });
    await expect(runCreateAndPoll(validateRunInput(baseInput), deps)).rejects.toMatchObject({
      code: "NOT_ENTITLED",
    });
    expect(posts).toHaveLength(1);
  });

  test("timeout when a check never settles returns partial results, never a second create", async () => {
    // Render is complete; the code-analysis check stays processing, so the
    // workflow times out on the check (not the render) and never re-POSTs.
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
});
