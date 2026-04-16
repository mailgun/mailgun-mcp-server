import { describe, test, expect, vi, afterAll } from "vitest";
import { z } from "zod";
import { processPathParameters, separateParameters, appendQueryString } from "../src/tools.js";
import { generateToolsFromOpenApi } from "../src/tools.js";
import {
  openapiToZod,
  loadOpenApiSpec,
  getOperationDetails,
  getRequestContentType,
  resolveReference,
} from "../src/openapi.js";
import {
  buildParamsSchema,
  processParameters,
  processRequestBody,
  sanitizeToolId,
  sanitizePropertyKey,
} from "../src/schema.js";
import { endpoints } from "../src/endpoints.js";
import type { OpenApiOperation, OpenApiParameter, OpenApiRequestBody, OpenApiSpec } from "../src/types.js";

type ZodDefInternals = {
  typeName?: string;
  values?: ReadonlyArray<string | number>;
  checks?: ReadonlyArray<{ kind: string; value?: number }>;
  description?: string;
};

// Zod 4 renamed `_def.typeName` → `def.type` (lowercase, e.g. "string"), replaced enum
// `values` with `entries`, reshaped check objects, and moved `description` off the def
// onto the schema. Normalize back to the shape the assertions below expect.
function zodDef(schema: z.ZodType): ZodDefInternals {
  const typeName = schema.def.type
    ? "Zod" + schema.def.type.charAt(0).toUpperCase() + schema.def.type.slice(1)
    : undefined;

  const values = schema instanceof z.ZodEnum ? Object.values(schema.def.entries) : undefined;

  const checks = schema.def.checks?.map((c) => {
    const cdef = c._zod.def;
    let kind: string = cdef.check ?? "";
    if (kind === "greater_than") kind = "min";
    else if (kind === "less_than") kind = "max";
    else if (kind === "string_format" && "format" in cdef && typeof cdef.format === "string") {
      kind = cdef.format;
    }
    const value = "value" in cdef && typeof cdef.value === "number" ? cdef.value : undefined;
    return { kind, value };
  });

  return { typeName, values, checks, description: schema.description };
}

// Zod 4 deprecated `.isOptional()`; the recommended replacement is probing with safeParse(undefined).
const isOptional = (schema: z.ZodType): boolean => schema.safeParse(undefined).success;

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
console.error = vi.fn();
console.warn = vi.fn();

const originalProcessExit = process.exit;
process.exit = vi.fn() as never;

describe("Mailgun MCP Server", () => {
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

  describe("sanitizeToolId()", () => {
    test("lowercases and replaces non-word characters", () => {
      expect(sanitizeToolId("GET-/v3/domains")).toBe("get-v3-domains");
    });

    test("preserves hyphens and underscores", () => {
      expect(sanitizeToolId("get-v3-domain_name")).toBe("get-v3-domain_name");
    });

    test("strips leading and trailing dashes", () => {
      expect(sanitizeToolId("/v3/domains/{name}/")).toBe("v3-domains-name");
    });
  });

  describe("getRequestContentType()", () => {
    test("returns form-urlencoded when no requestBody", () => {
      const result = getRequestContentType({});
      expect(result).toBe("application/x-www-form-urlencoded");
    });

    test("returns application/json when available", () => {
      const operation: OpenApiOperation = {
        requestBody: {
          content: {
            "application/json": { schema: { type: "object" } },
          },
        },
      };
      expect(getRequestContentType(operation)).toBe("application/json");
    });

    test("prefers application/json over form-urlencoded", () => {
      const operation: OpenApiOperation = {
        requestBody: {
          content: {
            "application/x-www-form-urlencoded": { schema: { type: "object" } },
            "application/json": { schema: { type: "object" } },
          },
        },
      };
      expect(getRequestContentType(operation)).toBe("application/json");
    });

    test("returns form-urlencoded when only that is available", () => {
      const operation: OpenApiOperation = {
        requestBody: {
          content: {
            "application/x-www-form-urlencoded": { schema: { type: "object" } },
          },
        },
      };
      expect(getRequestContentType(operation)).toBe("application/x-www-form-urlencoded");
    });

    test("returns form-urlencoded when only multipart/form-data is available", () => {
      const operation: OpenApiOperation = {
        requestBody: {
          content: {
            "multipart/form-data": { schema: { type: "object" } },
          },
        },
      };
      expect(getRequestContentType(operation)).toBe("application/x-www-form-urlencoded");
    });

    test("falls back to form-urlencoded for unknown content types", () => {
      const operation: OpenApiOperation = {
        requestBody: {
          content: {
            "text/plain": { schema: { type: "string" } },
          },
        },
      };
      expect(getRequestContentType(operation)).toBe("application/x-www-form-urlencoded");
    });
  });

  describe("processParameters()", () => {
    test("processes required parameters", () => {
      const params: OpenApiParameter[] = [
        { name: "domain", in: "path", required: true, schema: { type: "string" } },
      ];
      const schema: Record<string, z.ZodType> = {};

      processParameters(params, schema, {});

      expect(schema.domain).toBeDefined();
      expect(isOptional(schema.domain)).toBe(false);
    });

    test("processes optional parameters", () => {
      const params: OpenApiParameter[] = [
        { name: "limit", in: "query", required: false, schema: { type: "number" } },
      ];
      const schema: Record<string, z.ZodType> = {};

      processParameters(params, schema, {});

      expect(schema.limit).toBeDefined();
      expect(isOptional(schema.limit)).toBe(true);
    });

    test("processes multiple parameters", () => {
      const params: OpenApiParameter[] = [
        { name: "domain", in: "path", required: true, schema: { type: "string" } },
        { name: "limit", in: "query", required: false, schema: { type: "number" } },
        { name: "page", in: "query", required: false, schema: { type: "number" } },
      ];
      const schema: Record<string, unknown> = {};

      processParameters(params, schema as never, {});

      expect(Object.keys(schema)).toEqual(["domain", "limit", "page"]);
    });

    test("uses parameter-level description when schema has none", () => {
      const params: OpenApiParameter[] = [
        {
          name: "limit",
          in: "query",
          required: false,
          description: "Max count of items",
          schema: { type: "integer" },
        },
      ];
      const schema: Record<string, z.ZodType> = {};

      processParameters(params, schema, {});

      expect(schema.limit.description).toBe("Max count of items");
    });

    test("preserves schema-level description over parameter-level description", () => {
      const params: OpenApiParameter[] = [
        {
          name: "limit",
          in: "query",
          required: false,
          description: "Param-level desc",
          schema: { type: "integer", description: "Schema-level desc" },
        },
      ];
      const schema: Record<string, z.ZodType> = {};

      processParameters(params, schema, {});

      expect(schema.limit.description).toBe("Schema-level desc");
    });
  });

  describe("buildParamsSchema()", () => {
    test("returns { paramsSchema, keyMapping } shape", () => {
      const operation: OpenApiOperation = {
        parameters: [
          { name: "domain_name", in: "path", required: true, schema: { type: "string" } },
        ],
      };

      const result = buildParamsSchema(operation, {});

      expect(result).toHaveProperty("paramsSchema");
      expect(result).toHaveProperty("keyMapping");
      expect(typeof result.keyMapping).toBe("object");
    });

    test("builds schema from path and query params", () => {
      const operation: OpenApiOperation = {
        parameters: [
          { name: "domain_name", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "number" } },
        ],
      };

      const { paramsSchema } = buildParamsSchema(operation, {});

      expect(paramsSchema.domain_name).toBeDefined();
      expect(isOptional(paramsSchema.domain_name)).toBe(false);
      expect(paramsSchema.limit).toBeDefined();
      expect(isOptional(paramsSchema.limit)).toBe(true);
    });

    test("builds schema including request body properties", () => {
      const operation: OpenApiOperation = {
        parameters: [
          { name: "domain_name", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                properties: {
                  to: { type: "string", description: "Recipient" },
                  subject: { type: "string", description: "Subject line" },
                },
                required: ["to"],
              },
            },
          },
        },
      };

      const { paramsSchema } = buildParamsSchema(operation, {});

      expect(paramsSchema.domain_name).toBeDefined();
      expect(paramsSchema.to).toBeDefined();
      expect(isOptional(paramsSchema.to)).toBe(false);
      expect(paramsSchema.subject).toBeDefined();
      expect(isOptional(paramsSchema.subject)).toBe(true);
    });

    test("handles operation with no parameters", () => {
      const operation: OpenApiOperation = {};

      const { paramsSchema, keyMapping } = buildParamsSchema(operation, {});

      expect(paramsSchema).toEqual({});
      expect(keyMapping).toEqual({});
    });

    test("sanitizes property keys with colons and records mapping", () => {
      const operation: OpenApiOperation = {
        parameters: [
          { name: "o:tag", in: "query", required: false, schema: { type: "string" } },
          { name: "o:tracking", in: "query", required: false, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                properties: {
                  "t:version": { type: "string", description: "Template version" },
                },
              },
            },
          },
        },
      };

      const { paramsSchema, keyMapping } = buildParamsSchema(operation, {});

      expect(paramsSchema["o_tag"]).toBeDefined();
      expect(paramsSchema["o_tracking"]).toBeDefined();
      expect(paramsSchema["t_version"]).toBeDefined();

      expect(paramsSchema["o:tag"]).toBeUndefined();
      expect(paramsSchema["o:tracking"]).toBeUndefined();
      expect(paramsSchema["t:version"]).toBeUndefined();

      expect(keyMapping["o_tag"]).toBe("o:tag");
      expect(keyMapping["o_tracking"]).toBe("o:tracking");
      expect(keyMapping["t_version"]).toBe("t:version");
    });

    test("does not add clean keys to keyMapping", () => {
      const operation: OpenApiOperation = {
        parameters: [
          { name: "domain_name", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "number" } },
        ],
      };

      const { keyMapping } = buildParamsSchema(operation, {});

      expect(Object.keys(keyMapping)).toHaveLength(0);
    });
  });

  describe("processRequestBody()", () => {
    test("processes JSON request body", () => {
      const requestBody: OpenApiRequestBody = {
        content: {
          "application/json": {
            schema: {
              properties: {
                name: { type: "string" },
                count: { type: "number" },
              },
              required: ["name"],
            },
          },
        },
      };
      const schema: Record<string, z.ZodType> = {};

      processRequestBody(requestBody, schema, {});

      expect(schema.name).toBeDefined();
      expect(isOptional(schema.name)).toBe(false);
      expect(schema.count).toBeDefined();
      expect(isOptional(schema.count)).toBe(true);
    });

    test("processes form-urlencoded request body", () => {
      const requestBody: OpenApiRequestBody = {
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              properties: {
                to: { type: "string" },
                from: { type: "string" },
              },
              required: ["to", "from"],
            },
          },
        },
      };
      const schema: Record<string, unknown> = {};

      processRequestBody(requestBody, schema as never, {});

      expect(schema.to).toBeDefined();
      expect(schema.from).toBeDefined();
    });

    test("resolves $ref in body schema", () => {
      const spec: OpenApiSpec = {
        components: {
          schemas: {
            MessageBody: {
              properties: {
                to: { type: "string" },
              },
              required: ["to"],
            },
          },
        },
      };
      const requestBody: OpenApiRequestBody = {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/MessageBody" },
          },
        },
      };
      const schema: Record<string, z.ZodType> = {};

      processRequestBody(requestBody, schema, spec);

      expect(schema.to).toBeDefined();
      expect(isOptional(schema.to)).toBe(false);
    });

    test("resolves $ref in body properties", () => {
      const spec: OpenApiSpec = {
        components: {
          schemas: {
            EmailType: { type: "string", format: "email" },
          },
        },
      };
      const requestBody: OpenApiRequestBody = {
        content: {
          "application/json": {
            schema: {
              properties: {
                email: { $ref: "#/components/schemas/EmailType" },
              },
              required: ["email"],
            },
          },
        },
      };
      const schema: Record<string, unknown> = {};

      processRequestBody(requestBody, schema as never, spec);

      expect(schema.email).toBeDefined();
    });

    test("does nothing when content is missing", () => {
      const schema: Record<string, unknown> = {};
      processRequestBody({}, schema as never, {});
      expect(schema).toEqual({});
    });
  });

  describe("loadOpenApiSpec()", () => {
    test("throws error for non-existent file", () => {
      expect(() => {
        loadOpenApiSpec("/nonexistent/path/openapi.yaml");
      }).toThrow();
    });
  });

  describe("generateToolsFromOpenApi()", () => {
    test("warns for endpoints not found in spec", () => {
      (console.warn as ReturnType<typeof vi.fn>).mockClear();

      generateToolsFromOpenApi({ paths: {} }, { tool: vi.fn() } as never);

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

      expect(() => generateToolsFromOpenApi(spec, { tool: vi.fn() } as never)).not.toThrow();
    });
  });

  afterAll(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    process.exit = originalProcessExit;
  });
});

describe("openapiToZod()", () => {
  test("returns z.any() for null/undefined schema", () => {
    const result = openapiToZod(null, {});
    expect(zodDef(result).typeName).toBe("ZodAny");
  });

  test("converts string schema", () => {
    const result = openapiToZod({ type: "string", description: "A test string" }, {});
    expect(zodDef(result).typeName).toBe("ZodString");
    expect(zodDef(result).description).toBe("A test string");
  });

  test("converts string with email format", () => {
    const result = openapiToZod({ type: "string", format: "email" }, {});
    expect(zodDef(result).typeName).toBe("ZodString");
    expect(zodDef(result).checks!.some((c: { kind: string }) => c.kind === "email")).toBe(true);
  });

  test("converts string with uri format", () => {
    const result = openapiToZod({ type: "string", format: "uri", description: "A link" }, {});
    expect(zodDef(result).typeName).toBe("ZodString");
    expect(zodDef(result).description).toBe("URI: A link");
  });

  test("converts enum schema", () => {
    const result = openapiToZod({ type: "string", enum: ["yes", "no", "maybe"] }, {});
    expect(zodDef(result).typeName).toBe("ZodEnum");
    expect(zodDef(result).values).toEqual(["yes", "no", "maybe"]);
    expect(zodDef(result).description).toBe("");
  });

  test("converts enum schema with description", () => {
    const result = openapiToZod(
      { type: "string", enum: ["yes", "no"], description: "Enable tracking" },
      {}
    );
    expect(zodDef(result).typeName).toBe("ZodEnum");
    expect(zodDef(result).values).toEqual(["yes", "no"]);
    expect(zodDef(result).description).toBe("Enable tracking");
  });

  test("converts number schema with constraints", () => {
    const result = openapiToZod(
      {
        type: "number",
        minimum: 1,
        maximum: 100,
        description: "A constrained number",
      },
      {}
    );
    expect(zodDef(result).typeName).toBe("ZodNumber");
    expect(
      zodDef(result).checks!.some((c: { kind: string; value?: number }) => c.kind === "min" && c.value === 1)
    ).toBe(true);
    expect(
      zodDef(result).checks!.some((c: { kind: string; value?: number }) => c.kind === "max" && c.value === 100)
    ).toBe(true);
  });

  test("converts integer schema", () => {
    const result = openapiToZod({ type: "integer", description: "An int" }, {});
    expect(zodDef(result).typeName).toBe("ZodNumber");
  });

  test("converts boolean schema", () => {
    const result = openapiToZod({ type: "boolean", description: "A flag" }, {});
    expect(zodDef(result).typeName).toBe("ZodBoolean");
  });

  test("converts array schema", () => {
    const result = openapiToZod(
      {
        type: "array",
        items: { type: "string" },
        description: "A list",
      },
      {}
    );
    expect(zodDef(result).typeName).toBe("ZodArray");
  });

  test("converts object schema with properties", () => {
    const result = openapiToZod(
      {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name"],
        description: "A person",
      },
      {}
    );
    expect(zodDef(result).typeName).toBe("ZodObject");
  });

  test("converts object schema without properties to record", () => {
    const result = openapiToZod({ type: "object" }, {});
    expect(zodDef(result).typeName).toBe("ZodRecord");
  });

  test("converts schema with properties but no type", () => {
    const result = openapiToZod(
      {
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
      {}
    );
    expect(zodDef(result).typeName).toBe("ZodObject");
  });

  test("converts oneOf schema", () => {
    const result = openapiToZod(
      {
        oneOf: [{ type: "string" }, { type: "number" }],
      },
      {}
    );
    expect(zodDef(result).typeName).toBe("ZodUnion");
  });

  test("converts anyOf schema", () => {
    const result = openapiToZod(
      {
        anyOf: [{ type: "string" }, { type: "boolean" }],
      },
      {}
    );
    expect(zodDef(result).typeName).toBe("ZodUnion");
  });

  test("resolves $ref correctly", () => {
    const fullSpec: OpenApiSpec = {
      components: {
        schemas: {
          TestType: { type: "string", description: "Referenced type" },
        },
      },
    };
    const result = openapiToZod({ $ref: "#/components/schemas/TestType" }, fullSpec);
    expect(zodDef(result).typeName).toBe("ZodString");
    expect(zodDef(result).description).toBe("Referenced type");
  });

  test("handles unresolvable $ref with fallback", () => {
    const result = openapiToZod(
      { $ref: "#/components/schemas/Missing" },
      { components: { schemas: {} } }
    );
    expect(zodDef(result).typeName).toBe("ZodAny");
  });

  test("handles EventSeverityType $ref fallback", () => {
    const result = openapiToZod(
      { $ref: "#/components/schemas/EventSeverityType" },
      { components: { schemas: {} } }
    );
    expect(zodDef(result).typeName).toBe("ZodEnum");
    expect(zodDef(result).values).toEqual(["temporary", "permanent"]);
  });

  test("handles unsupported $ref format", () => {
    const result = openapiToZod({ $ref: "external.yaml#/Type" }, {});
    expect(zodDef(result).typeName).toBe("ZodAny");
  });

  test("returns z.any() for unknown type with no properties", () => {
    const result = openapiToZod({ type: "unknown_type" }, {});
    expect(zodDef(result).typeName).toBe("ZodAny");
  });
});

describe("getOperationDetails()", () => {
  test("returns operation details for valid path and method", () => {
    const openApiSpec: OpenApiSpec = {
      paths: {
        "/test/path": {
          get: { operationId: "getTest", summary: "Test operation" },
        },
      },
    };

    const result = getOperationDetails(openApiSpec, "get", "/test/path");

    expect(result).toEqual({
      operation: { operationId: "getTest", summary: "Test operation" },
      operationId: "get--test-path",
    });
  });

  test("returns null for invalid path", () => {
    const openApiSpec: OpenApiSpec = {
      paths: { "/test/path": { get: { summary: "Test" } } },
    };
    expect(getOperationDetails(openApiSpec, "get", "/nonexistent")).toBeNull();
  });

  test("returns null for invalid method", () => {
    const openApiSpec: OpenApiSpec = {
      paths: { "/test/path": { get: { summary: "Test" } } },
    };
    expect(getOperationDetails(openApiSpec, "post", "/test/path")).toBeNull();
  });

  test("handles case-insensitive method", () => {
    const openApiSpec: OpenApiSpec = {
      paths: { "/test": { post: { summary: "Post test" } } },
    };
    const result = getOperationDetails(openApiSpec, "POST", "/test");
    expect(result!.operation.summary).toBe("Post test");
  });
});

describe("endpoint validation against OpenAPI spec", () => {
  const openApiSpec = loadOpenApiSpec(
    new URL("../src/openapi.yaml", import.meta.url).pathname
  );

  test("every endpoint matches a path and method in the OpenAPI spec", () => {
    const missing: string[] = [];
    for (const endpoint of endpoints) {
      const [method, path] = endpoint.split(" ");
      const result = getOperationDetails(openApiSpec, method, path);
      if (!result) missing.push(endpoint);
    }
    expect(missing).toEqual([]);
  });

  test("every endpoint produces a tool ID within the 64 character limit (no truncation)", () => {
    const truncated: { endpoint: string; toolId: string; length: number }[] = [];
    for (const endpoint of endpoints) {
      const [method, path] = endpoint.split(" ");
      const operationId = `${method}-${path}`;
      const fullId = operationId
        .replace(/[^\w-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      const toolId = sanitizeToolId(operationId);
      if (fullId.length > 64) {
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

describe("resolveReference()", () => {
  test("resolves reference path correctly", () => {
    const spec: OpenApiSpec = {
      components: { schemas: { TestSchema: { type: "string" } } },
    };
    expect(resolveReference("#/components/schemas/TestSchema", spec)).toEqual({
      type: "string",
    });
  });

  test("handles nested reference path", () => {
    const spec = {
      components: { schemas: { Parent: { NestedType: { type: "number" } } } },
    } as unknown as OpenApiSpec;
    expect(resolveReference("#/components/schemas/Parent/NestedType", spec)).toEqual({
      type: "number",
    });
  });
});

describe("sanitizePropertyKey()", () => {
  test("replaces colons with underscores", () => {
    expect(sanitizePropertyKey("o:tag")).toBe("o_tag");
    expect(sanitizePropertyKey("o:tracking")).toBe("o_tracking");
    expect(sanitizePropertyKey("t:version")).toBe("t_version");
  });

  test("replaces at-signs with underscores", () => {
    expect(sanitizePropertyKey("@timestamp")).toBe("_timestamp");
  });

  test("leaves clean keys unchanged", () => {
    expect(sanitizePropertyKey("domain_name")).toBe("domain_name");
    expect(sanitizePropertyKey("limit")).toBe("limit");
    expect(sanitizePropertyKey("some.dotted.key")).toBe("some.dotted.key");
    expect(sanitizePropertyKey("key-with-dashes")).toBe("key-with-dashes");
  });

  test("truncates keys longer than 64 characters", () => {
    const longKey = "a".repeat(100);
    expect(sanitizePropertyKey(longKey)).toHaveLength(64);
  });

  test("handles multiple special characters", () => {
    expect(sanitizePropertyKey("h:X-My-Header")).toBe("h_X-My-Header");
    expect(sanitizePropertyKey("v:my-var")).toBe("v_my-var");
  });
});

describe("schema property key validation against Anthropic API pattern", () => {
  const openApiSpec = loadOpenApiSpec(
    new URL("../src/openapi.yaml", import.meta.url).pathname
  );
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
