import { describe, test, expect } from "vitest";
import { z } from "zod";
import {
  openapiToZod,
  loadOpenApiSpec,
  getOperationDetails,
  getRequestContentType,
  resolveReference,
} from "../src/openapi.js";
import type { OpenApiOperation, OpenApiSpec } from "../src/types.js";

type ZodDefInternals = {
  typeName?: string;
  values?: ReadonlyArray<string | number>;
  checks?: ReadonlyArray<{ kind: string; value?: number }>;
  description?: string;
};

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
    expect(result.safeParse("user@example.com").success).toBe(true);
    expect(result.safeParse("not-an-email").success).toBe(false);
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
      {},
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
      {},
    );
    expect(zodDef(result).typeName).toBe("ZodNumber");
    expect(
      zodDef(result).checks!.some(
        (c: { kind: string; value?: number }) => c.kind === "min" && c.value === 1,
      ),
    ).toBe(true);
    expect(
      zodDef(result).checks!.some(
        (c: { kind: string; value?: number }) => c.kind === "max" && c.value === 100,
      ),
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
      {},
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
      {},
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
      {},
    );
    expect(zodDef(result).typeName).toBe("ZodObject");
  });

  test("converts oneOf schema", () => {
    const result = openapiToZod(
      {
        oneOf: [{ type: "string" }, { type: "number" }],
      },
      {},
    );
    expect(zodDef(result).typeName).toBe("ZodUnion");
  });

  test("converts anyOf schema", () => {
    const result = openapiToZod(
      {
        anyOf: [{ type: "string" }, { type: "boolean" }],
      },
      {},
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
      { components: { schemas: {} } },
    );
    expect(zodDef(result).typeName).toBe("ZodAny");
  });

  test("handles EventSeverityType $ref fallback", () => {
    const result = openapiToZod(
      { $ref: "#/components/schemas/EventSeverityType" },
      { components: { schemas: {} } },
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

describe("loadOpenApiSpec()", () => {
  test("throws error for non-existent file", () => {
    expect(() => {
      loadOpenApiSpec("/nonexistent/path/openapi.yaml");
    }).toThrow(/ENOENT|no such file/i);
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
