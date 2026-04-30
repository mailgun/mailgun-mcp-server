import { describe, test, expect } from "vitest";
import { z } from "zod";
import { loadOpenApiSpec, getOperationDetails, getRequestContentType } from "../src/openapi.js";
import { buildParamsSchema, sanitizeToolId } from "../src/schema.js";
import { endpoints } from "../src/endpoints.js";

const isOptional = (schema: z.ZodType): boolean => schema.safeParse(undefined).success;

const openApiSpec = loadOpenApiSpec(new URL("../src/openapi.yaml", import.meta.url).pathname);

describe("endpoint validation against OpenAPI spec", () => {
  test("every endpoint matches a path and method in the OpenAPI spec", () => {
    const missing: string[] = [];
    for (const endpoint of endpoints) {
      const [method, path] = endpoint.split(" ");
      const result = getOperationDetails(openApiSpec, method, path);
      if (!result) missing.push(endpoint);
    }
    expect(missing).toEqual([]);
  });

  test("every endpoint produces a tool ID within the 53 character limit (no truncation)", () => {
    const truncated: { endpoint: string; toolId: string; length: number }[] = [];
    for (const endpoint of endpoints) {
      const [method, path] = endpoint.split(" ");
      const operationId = `${method}-${path}`;
      const fullId = operationId
        .replace(/[^\w-]/g, "-")
        .replace(/_name(?=-|$)/g, "")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      const toolId = sanitizeToolId(operationId);
      if (fullId.length > 53) {
        truncated.push({ endpoint, toolId, length: fullId.length });
      }
    }
    expect(truncated).toEqual([]);
  });

  test("every endpoint produces a unique tool ID", () => {
    const toolIds = new Map<string, string[]>();
    for (const endpoint of endpoints) {
      const [method, path] = endpoint.split(" ");
      const operationId = `${method}-${path.replace(/[^\w-]/g, "-").replace(/-+/g, "-")}`;
      const toolId = sanitizeToolId(operationId);
      if (toolIds.has(toolId)) {
        toolIds.get(toolId)!.push(endpoint);
      } else {
        toolIds.set(toolId, [endpoint]);
      }
    }
    const duplicates = [...toolIds.entries()].filter(([, eps]) => eps.length > 1);
    expect(duplicates).toEqual([]);
  });

  test("every endpoint resolves to a supported content type", () => {
    const unsupported: { endpoint: string; contentType: string }[] = [];
    for (const endpoint of endpoints) {
      const [method, path] = endpoint.split(" ");
      const result = getOperationDetails(openApiSpec, method, path);
      if (!result) continue;
      const contentType = getRequestContentType(result.operation);
      if (!["application/json", "application/x-www-form-urlencoded"].includes(contentType)) {
        unsupported.push({ endpoint, contentType });
      }
    }
    expect(unsupported).toEqual([]);
  });
});

describe("schema property key validation against Anthropic API pattern", () => {
  const KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;

  test("all generated tool schemas have property keys matching the API pattern", () => {
    const violations: { endpoint: string; key: string }[] = [];

    for (const endpoint of endpoints) {
      const [method, path] = endpoint.split(" ");
      const details = getOperationDetails(openApiSpec, method, path);
      if (!details) continue;

      const { paramsSchema } = buildParamsSchema(details.operation, openApiSpec);

      for (const key of Object.keys(paramsSchema)) {
        if (!KEY_PATTERN.test(key)) {
          violations.push({ endpoint, key });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("new endpoint validation against OpenAPI spec", () => {
  test("validate endpoint resolves in the spec", () => {
    const result = getOperationDetails(openApiSpec, "GET", "/v4/address/validate");
    expect(result).not.toBeNull();
    expect(result!.operation.summary).toBe("Validate Address V4");
  });

  test("inbox placement result endpoint resolves in the spec", () => {
    const result = getOperationDetails(openApiSpec, "GET", "/v4/inbox/results/{result}");
    expect(result).not.toBeNull();
    expect(result!.operation.summary).toBe("Get Result Details");
  });

  test("preview test results endpoint resolves in the spec", () => {
    const result = getOperationDetails(openApiSpec, "GET", "/v1/preview/tests/{test_id}/results");
    expect(result).not.toBeNull();
    expect(result!.operation.summary).toBe("Get Test Results");
  });

  test("validate endpoint produces a valid params schema", () => {
    const result = getOperationDetails(openApiSpec, "GET", "/v4/address/validate");
    const { paramsSchema } = buildParamsSchema(result!.operation, openApiSpec);
    expect(paramsSchema.address).toBeDefined();
    expect(isOptional(paramsSchema.address)).toBe(false);
    expect(paramsSchema.provider_lookup).toBeDefined();
    expect(isOptional(paramsSchema.provider_lookup)).toBe(true);
  });

  test("inbox placement endpoint produces a valid params schema", () => {
    const result = getOperationDetails(openApiSpec, "GET", "/v4/inbox/results/{result}");
    const { paramsSchema } = buildParamsSchema(result!.operation, openApiSpec);
    expect(paramsSchema.result).toBeDefined();
    expect(isOptional(paramsSchema.result)).toBe(false);
  });

  test("preview results endpoint produces a valid params schema", () => {
    const result = getOperationDetails(
      openApiSpec,
      "GET",
      "/v1/preview/tests/{test_id}/results",
    );
    const { paramsSchema } = buildParamsSchema(result!.operation, openApiSpec);
    expect(paramsSchema.test_id).toBeDefined();
    expect(isOptional(paramsSchema.test_id)).toBe(false);
  });
});
