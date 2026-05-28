import { describe, test, expect } from "vitest";
import { z } from "zod";
import {
  buildParamsSchema,
  processParameters,
  processRequestBody,
  sanitizeToolId,
  sanitizePropertyKey,
} from "../src/schema.js";
import type {
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiSpec,
} from "../src/types.js";

const isOptional = (schema: z.ZodType): boolean => schema.safeParse(undefined).success;

describe("sanitizeToolId()", () => {
  test("lowercases and replaces non-word characters", () => {
    expect(sanitizeToolId("GET-/v3/domains")).toBe("get-v3-domains");
  });

  test("preserves hyphens and underscores", () => {
    expect(sanitizeToolId("get-v3-domain_tag")).toBe("get-v3-domain_tag");
  });

  test("strips _name suffixes from path parameter segments", () => {
    expect(sanitizeToolId("get-v3-domain_name")).toBe("get-v3-domain");
    expect(sanitizeToolId("get-v3-domain_name-templates-template_name")).toBe(
      "get-v3-domain-templates-template",
    );
  });

  test("strips leading and trailing dashes", () => {
    expect(sanitizeToolId("/v3/domains/{name}/")).toBe("v3-domains-name");
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
