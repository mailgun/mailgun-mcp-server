import { describe, test, expect } from "vitest";
import { z } from "zod";
import { loadOpenApiSpec, getOperationDetails, getRequestContentType } from "../src/openapi.js";
import { buildParamsSchema, sanitizeToolId } from "../src/schema.js";
import { endpointGroups, endpointLabel, endpoints, parseEndpointEntry } from "../src/endpoints.js";
import { isKnownTag, TOOLSET_IDS, toolsetTag } from "../src/tags.js";

const isOptional = (schema: z.ZodType): boolean => schema.safeParse(undefined).success;

const openApiSpec = loadOpenApiSpec(new URL("../src/openapi.yaml", import.meta.url).pathname);

describe("endpoint validation against OpenAPI spec", () => {
  test("every endpoint matches a path and method in the OpenAPI spec", () => {
    const missing: string[] = [];
    for (const entry of endpoints) {
      const { method, path } = parseEndpointEntry(entry);
      const result = getOperationDetails(openApiSpec, method, path);
      if (!result) missing.push(endpointLabel(entry));
    }
    expect(missing).toEqual([]);
  });

  test("every endpoint produces a tool ID within the 53 character limit (no truncation)", () => {
    const truncated: { endpoint: string; toolId: string; length: number }[] = [];
    for (const entry of endpoints) {
      const { method, path, toolNameOverride } = parseEndpointEntry(entry);
      const label = endpointLabel(entry);

      if (toolNameOverride !== undefined) {
        if (toolNameOverride.length > 53) {
          truncated.push({
            endpoint: label,
            toolId: toolNameOverride,
            length: toolNameOverride.length,
          });
        }
        continue;
      }

      const operationId = `${method}-${path}`;
      const fullId = operationId
        .replace(/[^\w-]/g, "-")
        .replace(/_name(?=-|$)/g, "")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      const toolId = sanitizeToolId(operationId);
      if (fullId.length > 53) {
        truncated.push({ endpoint: label, toolId, length: fullId.length });
      }
    }
    expect(truncated).toEqual([]);
  });

  test("every endpoint produces a unique tool ID", () => {
    const toolIds = new Map<string, string[]>();
    for (const entry of endpoints) {
      const { method, path, toolNameOverride } = parseEndpointEntry(entry);
      const operationId = `${method}-${path.replace(/[^\w-]/g, "-").replace(/-+/g, "-")}`;
      const toolId = toolNameOverride ?? sanitizeToolId(operationId);
      const label = endpointLabel(entry);
      if (toolIds.has(toolId)) {
        toolIds.get(toolId)!.push(label);
      } else {
        toolIds.set(toolId, [label]);
      }
    }
    const duplicates = [...toolIds.entries()].filter(([, eps]) => eps.length > 1);
    expect(duplicates).toEqual([]);
  });

  test("every endpoint resolves to a supported content type", () => {
    const unsupported: { endpoint: string; contentType: string }[] = [];
    for (const entry of endpoints) {
      const { method, path } = parseEndpointEntry(entry);
      const result = getOperationDetails(openApiSpec, method, path);
      if (!result) continue;
      const contentType = getRequestContentType(result.operation);
      if (!["application/json", "application/x-www-form-urlencoded"].includes(contentType)) {
        unsupported.push({ endpoint: endpointLabel(entry), contentType });
      }
    }
    expect(unsupported).toEqual([]);
  });

  test("overrides rename validate / inbox / preview tools", () => {
    const byEndpoint = new Map<string, string | undefined>();
    for (const entry of endpoints) {
      const { method, path, toolNameOverride } = parseEndpointEntry(entry);
      byEndpoint.set(`${method} ${path}`, toolNameOverride);
    }
    expect(byEndpoint.get("GET /v4/address/validate")).toBe("validate_email");
    expect(byEndpoint.get("GET /v4/inbox/results/{result}")).toBe("get_inbox_placement_result");
    expect(byEndpoint.get("GET /v1/preview/tests/{test_id}/results")).toBe("get_preview_result");
  });

  test("validate / inbox / preview entries declare their explicit tags", () => {
    const tagsByEndpoint = new Map<string, readonly string[]>();
    for (const entry of endpoints) {
      const { method, path, tags } = parseEndpointEntry(entry);
      tagsByEndpoint.set(`${method} ${path}`, tags);
    }
    expect(tagsByEndpoint.get("GET /v4/address/validate")).toEqual(["validate"]);
    expect(tagsByEndpoint.get("GET /v4/inbox/results/{result}")).toEqual(["optimize"]);
    expect(tagsByEndpoint.get("GET /v1/preview/tests/{test_id}/results")).toEqual(["inspect"]);
  });

  test("every endpoint resolves to at least one known tag", () => {
    const violations: { endpoint: string; tags: readonly string[] }[] = [];
    for (const entry of endpoints) {
      const { tags } = parseEndpointEntry(entry);
      if (tags.length === 0 || !tags.every((t) => isKnownTag(t))) {
        violations.push({ endpoint: endpointLabel(entry), tags });
      }
    }
    expect(violations).toEqual([]);
  });

  test("untagged entries take the product tag of their toolset", () => {
    const untagged = endpoints.filter(({ entry }) => typeof entry === "string" || !entry.tags);
    expect(untagged.length).toBeGreaterThan(0);
    for (const endpoint of untagged) {
      const { tags } = parseEndpointEntry(endpoint);
      expect(tags).toEqual([toolsetTag(endpoint.toolset)]);
    }
  });
});

describe("toolset grouping", () => {
  test("covers all 80 endpoints", () => {
    expect(endpoints).toHaveLength(80);
  });

  test("every toolset has at least one endpoint", () => {
    const empty = TOOLSET_IDS.filter((id) => endpointGroups[id].length === 0);
    expect(empty).toEqual([]);
  });

  test("every endpoint is tagged with its toolset's product tag", () => {
    const violations = endpoints
      .map((endpoint) => ({ endpoint, parsed: parseEndpointEntry(endpoint) }))
      .filter(({ endpoint, parsed }) => !parsed.tags.includes(toolsetTag(endpoint.toolset)))
      .map(({ endpoint }) => endpointLabel(endpoint));
    expect(violations).toEqual([]);
  });

  test("core endpoints are the expected set", () => {
    const core = endpoints
      .map((endpoint) => parseEndpointEntry(endpoint))
      .filter(({ core }) => core)
      .map(({ method, path }) => `${method} ${path}`);
    expect(core).toEqual([
      "POST /v3/{domain_name}/messages",
      "GET /v4/domains",
      "GET /v4/domains/{name}",
      "PUT /v4/domains/{name}/verify",
      "GET /v3/domains/{name}/tracking",
      "POST /v1/analytics/metrics",
      "POST /v1/analytics/logs",
      "POST /v2/bounce-classification/metrics",
      "GET /v3/{domain_name}/bounces/{address}",
      "GET /v3/{domain_name}/bounces",
      "GET /v3/{domain_name}/unsubscribes",
      "GET /v3/{domain_name}/complaints",
      "GET /v3/{domain_name}/templates",
      "GET /v4/address/validate",
    ]);
  });
});

describe("readOnly classification", () => {
  const parsed = endpoints.map((endpoint) => parseEndpointEntry(endpoint));

  test("every GET endpoint is read-only", () => {
    const writes = parsed.filter((e) => e.method === "GET" && !e.readOnly);
    expect(writes).toEqual([]);
  });

  test("non-GET endpoints that only read data are read-only", () => {
    const readOnlyNonGets = parsed
      .filter((e) => e.method !== "GET" && e.readOnly)
      .map(({ method, path }) => `${method} ${path}`);
    expect(readOnlyNonGets).toEqual([
      "POST /v1/analytics/metrics",
      "POST /v1/analytics/usage/metrics",
      "POST /v1/analytics/logs",
      "POST /v2/bounce-classification/metrics",
    ]);
  });

  test("every other POST/PUT endpoint is a write", () => {
    expect(parsed.filter((e) => !e.readOnly)).toHaveLength(17);
  });
});

describe("schema property key validation against Anthropic API pattern", () => {
  const KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;

  test("all generated tool schemas have property keys matching the API pattern", () => {
    const violations: { endpoint: string; key: string }[] = [];

    for (const entry of endpoints) {
      const { method, path } = parseEndpointEntry(entry);
      const details = getOperationDetails(openApiSpec, method, path);
      if (!details) continue;

      const { paramsSchema } = buildParamsSchema(details.operation, openApiSpec);

      for (const key of Object.keys(paramsSchema)) {
        if (!KEY_PATTERN.test(key)) {
          violations.push({ endpoint: endpointLabel(entry), key });
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
    const result = getOperationDetails(openApiSpec, "GET", "/v1/preview/tests/{test_id}/results");
    const { paramsSchema } = buildParamsSchema(result!.operation, openApiSpec);
    expect(paramsSchema.test_id).toBeDefined();
    expect(isOptional(paramsSchema.test_id)).toBe(false);
  });
});

describe("Inspect email preview QA read primitives", () => {
  const inspectPrimitives: { endpoint: string; toolName: string; summary: string }[] = [
    {
      endpoint: "GET /v2/preview/tests",
      toolName: "list_preview_tests",
      summary: "List/Search Tests V2",
    },
    {
      endpoint: "GET /v2/preview/tests/{test_id}",
      toolName: "get_preview_test_status",
      summary: "Get Emailpreview Test Information V2",
    },
    {
      endpoint: "GET /v2/preview/tests/{test_id}/results/{client_id}",
      toolName: "get_preview_client_result",
      summary: "Get Test Results by client ID V2",
    },
    {
      endpoint: "GET /v1/preview/tests/clients",
      toolName: "list_preview_clients",
      summary: "List Clients",
    },
    {
      endpoint: "GET /v1/inspect/links/{id}",
      toolName: "get_link_validation_result",
      summary: "Get Link Validation Results",
    },
    {
      endpoint: "GET /v1/inspect/images/{id}",
      toolName: "get_image_validation_result",
      summary: "Get Image Validation Results",
    },
    {
      endpoint: "GET /v1/inspect/accessibility/{id}",
      toolName: "get_accessibility_result",
      summary: "Get Accessibility Test",
    },
    {
      endpoint: "GET /v1/inspect/analyze/{result_id}",
      toolName: "get_code_analysis_result",
      summary: "Get Code Analysis Results",
    },
  ];

  const parsed = new Map<string, ReturnType<typeof parseEndpointEntry>>();
  for (const entry of endpoints) {
    const p = parseEndpointEntry(entry);
    parsed.set(`${p.method} ${p.path}`, p);
  }

  test.each(inspectPrimitives)("$toolName resolves in the spec", ({ endpoint, summary }) => {
    const [method, path] = endpoint.split(" ");
    const result = getOperationDetails(openApiSpec, method, path);
    expect(result).not.toBeNull();
    expect(result!.operation.summary).toBe(summary);
  });

  test.each(inspectPrimitives)(
    "$toolName is allowlisted with the inspect tag",
    ({ endpoint, toolName }) => {
      const p = parsed.get(endpoint);
      expect(p).toBeDefined();
      expect(p!.toolNameOverride).toBe(toolName);
      expect(p!.tags).toEqual(["inspect"]);
    },
  );

  test("no create primitive (POST /v2/preview/tests) is allowlisted", () => {
    expect(parsed.has("POST /v2/preview/tests")).toBe(false);
  });

  test("existing get_preview_result remains mapped to the V1 results endpoint", () => {
    const p = parsed.get("GET /v1/preview/tests/{test_id}/results");
    expect(p?.toolNameOverride).toBe("get_preview_result");
    expect(p?.tags).toEqual(["inspect"]);
  });

  test("required path params are required and query params are optional", () => {
    const status = getOperationDetails(openApiSpec, "GET", "/v2/preview/tests/{test_id}");
    const statusSchema = buildParamsSchema(status!.operation, openApiSpec).paramsSchema;
    expect(statusSchema.test_id).toBeDefined();
    expect(isOptional(statusSchema.test_id)).toBe(false);

    const list = getOperationDetails(openApiSpec, "GET", "/v2/preview/tests");
    const listSchema = buildParamsSchema(list!.operation, openApiSpec).paramsSchema;
    expect(listSchema.results).toBeDefined();
    expect(isOptional(listSchema.results)).toBe(true);

    const clientResult = getOperationDetails(
      openApiSpec,
      "GET",
      "/v2/preview/tests/{test_id}/results/{client_id}",
    );
    const clientSchema = buildParamsSchema(clientResult!.operation, openApiSpec).paramsSchema;
    expect(isOptional(clientSchema.test_id)).toBe(false);
    expect(isOptional(clientSchema.client_id)).toBe(false);

    const analyze = getOperationDetails(openApiSpec, "GET", "/v1/inspect/analyze/{result_id}");
    const analyzeSchema = buildParamsSchema(analyze!.operation, openApiSpec).paramsSchema;
    expect(isOptional(analyzeSchema.result_id)).toBe(false);
    expect(analyzeSchema.slug).toBeDefined();
    expect(isOptional(analyzeSchema.slug)).toBe(true);
  });
});
