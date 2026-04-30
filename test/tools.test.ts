import { describe, test, expect, vi, afterAll } from "vitest";
import {
  processPathParameters,
  separateParameters,
  appendQueryString,
  formatErrorMessage,
} from "../src/tools.js";
import { generateToolsFromOpenApi } from "../src/tools.js";
import { MailgunApiError } from "../src/api.js";
import type { OpenApiOperation, OpenApiSpec } from "../src/types.js";

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
console.error = vi.fn<typeof console.error>();
console.warn = vi.fn<typeof console.warn>();

const originalProcessExit = process.exit;
process.exit = vi.fn<typeof process.exit>();

describe("processPathParameters()", () => {
  test("replaces path parameters with values", () => {
    const path = "/v3/{domain_name}/messages";
    const operation: OpenApiOperation = {
      parameters: [{ name: "domain_name", in: "path", required: true }],
    };
    const params = { domain_name: "example.com", to: "test@example.com" };

    const result = processPathParameters(path, operation, params);

    expect(result.actualPath).toBe("/v3/example.com/messages");
    expect(result.remainingParams).toEqual({ to: "test@example.com" });
  });

  test("replaces multiple path parameters", () => {
    const path = "/v3/{domain_name}/templates/{template_name}";
    const operation: OpenApiOperation = {
      parameters: [
        { name: "domain_name", in: "path", required: true },
        { name: "template_name", in: "path", required: true },
      ],
    };
    const params = { domain_name: "example.com", template_name: "welcome" };

    const result = processPathParameters(path, operation, params);

    expect(result.actualPath).toBe("/v3/example.com/templates/welcome");
    expect(result.remainingParams).toEqual({});
  });

  test("URL-encodes path parameter values", () => {
    const path = "/v3/{domain_name}/bounces/{address}";
    const operation: OpenApiOperation = {
      parameters: [
        { name: "domain_name", in: "path", required: true },
        { name: "address", in: "path", required: true },
      ],
    };
    const params = { domain_name: "example.com", address: "user@test.com" };

    const result = processPathParameters(path, operation, params);

    expect(result.actualPath).toBe("/v3/example.com/bounces/user%40test.com");
  });

  test("handles falsy path parameter values like 0 or empty string", () => {
    const path = "/v3/{id}/resource";
    const operation: OpenApiOperation = {
      parameters: [{ name: "id", in: "path", required: true }],
    };

    const resultZero = processPathParameters(path, operation, { id: 0 });
    expect(resultZero.actualPath).toBe("/v3/0/resource");

    const resultEmpty = processPathParameters(path, operation, { id: "" });
    expect(resultEmpty.actualPath).toBe("/v3//resource");
  });

  test("handles operation with no parameters", () => {
    const path = "/v3/routes";
    const operation: OpenApiOperation = {};
    const params = { limit: 10 };

    const result = processPathParameters(path, operation, params);

    expect(result.actualPath).toBe("/v3/routes");
    expect(result.remainingParams).toEqual({ limit: 10 });
  });

  test("throws error if required path parameter is missing", () => {
    const path = "/v3/{domain_name}/messages";
    const operation: OpenApiOperation = {
      parameters: [{ name: "domain_name", in: "path", required: true }],
    };
    const params = { to: "test@example.com" };

    expect(() => {
      processPathParameters(path, operation, params);
    }).toThrow(/required path parameter.*missing/i);
  });
});

describe("separateParameters()", () => {
  test("separates query and body parameters", () => {
    const params = {
      limit: 10,
      page: 1,
      to: "test@example.com",
      from: "sender@example.com",
    };
    const operation: OpenApiOperation = {
      parameters: [
        { name: "limit", in: "query" },
        { name: "page", in: "query" },
      ],
    };

    const result = separateParameters(params, operation, "POST");

    expect(result.queryParams).toEqual({ limit: 10, page: 1 });
    expect(result.bodyParams).toEqual({
      to: "test@example.com",
      from: "sender@example.com",
    });
  });

  test("moves all params to query for GET requests", () => {
    const params = {
      limit: 10,
      page: 1,
      to: "test@example.com",
      from: "sender@example.com",
    };
    const operation: OpenApiOperation = {
      parameters: [
        { name: "limit", in: "query" },
        { name: "page", in: "query" },
      ],
    };

    const result = separateParameters(params, operation, "GET");

    expect(result.queryParams).toEqual({
      limit: 10,
      page: 1,
      to: "test@example.com",
      from: "sender@example.com",
    });
    expect(result.bodyParams).toEqual({});
  });

  test("handles operation with no parameters defined", () => {
    const params = { to: "test@example.com" };
    const operation: OpenApiOperation = {};

    const result = separateParameters(params, operation, "POST");

    expect(result.queryParams).toEqual({});
    expect(result.bodyParams).toEqual({ to: "test@example.com" });
  });
});

describe("appendQueryString()", () => {
  test("appends query parameters to path", () => {
    const result = appendQueryString("/v3/domains", { limit: 10, skip: 0 });
    expect(result).toBe("/v3/domains?limit=10&skip=0");
  });

  test("returns original path if no query parameters", () => {
    const result = appendQueryString("/v3/domains", {});
    expect(result).toBe("/v3/domains");
  });

  test("skips null and undefined values", () => {
    const result = appendQueryString("/v3/domains", {
      limit: 10,
      skip: null,
      page: undefined,
    });
    expect(result).toBe("/v3/domains?limit=10");
  });

  test("returns original path when all values are null or undefined", () => {
    const result = appendQueryString("/v3/domains", {
      skip: null,
      page: undefined,
    });
    expect(result).toBe("/v3/domains");
  });
});

describe("generateToolsFromOpenApi()", () => {
  test("warns for endpoints not found in spec", () => {
    (console.warn as ReturnType<typeof vi.fn>).mockClear();

    generateToolsFromOpenApi({ paths: {} }, { registerTool: vi.fn<() => void>() } as never);

    expect(console.warn).toHaveBeenCalled();
  });

  test("registers tools for matching endpoints", () => {
    const spec: OpenApiSpec = {
      paths: {
        "/v4/domains": {
          get: {
            summary: "Get domains",
            parameters: [],
          },
        },
      },
    };
    const mockRegisterTool = vi.fn<(...args: unknown[]) => void>();

    generateToolsFromOpenApi(spec, { registerTool: mockRegisterTool } as never);

    expect(mockRegisterTool).toHaveBeenCalled();
    expect(mockRegisterTool.mock.calls[0][0]).toBe("get-v4-domains");
  });
});

describe("formatErrorMessage()", () => {
  test("formats 401 as authentication failure", () => {
    const err = new MailgunApiError("Unauthorized", 401, "Unauthorized");
    const msg = formatErrorMessage(err, "GET", "/v4/address/validate");
    expect(msg).toContain("Authentication failed");
    expect(msg).toContain("MAILGUN_API_KEY");
    expect(msg).toContain("GET /v4/address/validate");
  });

  test("formats 403 with plan upgrade guidance", () => {
    const err = new MailgunApiError("Forbidden", 403, "Forbidden");
    const msg = formatErrorMessage(err, "GET", "/v4/inbox/results/{result}");
    expect(msg).toContain("Access denied");
    expect(msg).toContain("plan");
    expect(msg).toContain("billing");
  });

  test("formats 404 with resource guidance", () => {
    const err = new MailgunApiError("Not found", 404, "Result not found");
    const msg = formatErrorMessage(err, "GET", "/v4/inbox/results/{result}");
    expect(msg).toContain("Resource not found");
    expect(msg).toContain("Result not found");
  });

  test("formats 400 with validation details", () => {
    const err = new MailgunApiError("Bad request", 400, "address is required");
    const msg = formatErrorMessage(err, "GET", "/v4/address/validate");
    expect(msg).toContain("Bad request");
    expect(msg).toContain("address is required");
  });

  test("formats unknown status codes with generic message", () => {
    const err = new MailgunApiError("Server error", 502, "Bad gateway");
    const msg = formatErrorMessage(err, "POST", "/v1/analytics/metrics");
    expect(msg).toContain("HTTP 502");
    expect(msg).toContain("Bad gateway");
  });

  test("handles non-MailgunApiError errors", () => {
    const err = new Error("Network timeout");
    const msg = formatErrorMessage(err, "GET", "/v4/domains");
    expect(msg).toBe("Error: Network timeout");
  });

  test("handles non-Error values", () => {
    const msg = formatErrorMessage("something broke", "GET", "/v4/domains");
    expect(msg).toBe("Error: something broke");
  });
});

afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  process.exit = originalProcessExit;
});
