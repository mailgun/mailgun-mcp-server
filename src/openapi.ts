import { z } from "zod";
import fs from "node:fs";
import yaml from "js-yaml";
import type {
  OpenApiSchema,
  OpenApiSpec,
  OpenApiOperation,
  OperationDetails,
} from "./types.js";

export function loadOpenApiSpec(filePath: string): OpenApiSpec {
  try {
    const fileContents = fs.readFileSync(filePath, "utf8");
    return yaml.load(fileContents) as OpenApiSpec;
  } catch (error) {
    console.error(`Error loading OpenAPI spec: ${(error as Error).message}`);
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
    throw error;
  }
}

export function openapiToZod(schema: OpenApiSchema | null | undefined, fullSpec: OpenApiSpec): z.ZodTypeAny {
  if (!schema) return z.any();
  if (schema.$ref) return resolveSchemaRef(schema.$ref, fullSpec);

  switch (schema.type) {
    case "string":   return convertStringSchema(schema);
    case "number":
    case "integer":  return convertNumberSchema(schema);
    case "boolean":  return z.boolean().describe(schema.description || "");
    case "array":    return z.array(openapiToZod(schema.items, fullSpec)).describe(schema.description || "");
    case "object":   return convertObjectSchema(schema, fullSpec);
    default:         return convertUntypedSchema(schema, fullSpec);
  }
}

function resolveSchemaRef(ref: string, fullSpec: OpenApiSpec): z.ZodType {
  if (!ref.startsWith("#/")) {
    console.error(`Unsupported reference format: ${ref}`);
    return z.any().describe(`Unsupported reference: ${ref}`);
  }

  const refPath = ref.substring(2).split("/");
  let referenced: unknown = fullSpec;

  for (const segment of refPath) {
    if (
      !referenced ||
      typeof referenced !== "object" ||
      !(segment in (referenced as Record<string, unknown>))
    ) {
      // The Mailgun spec references EventSeverityType but doesn't define it.
      if (segment === "EventSeverityType" || ref.endsWith("EventSeverityType")) {
        return z.enum(["temporary", "permanent"]).describe("Filter by event severity");
      }

      console.error(`Failed to resolve reference: ${ref}, segment: ${segment}`);
      return z.any().describe(`Failed reference: ${ref}`);
    }
    referenced = (referenced as Record<string, unknown>)[segment];
  }

  return openapiToZod(referenced as OpenApiSchema, fullSpec);
}

function convertStringSchema(schema: OpenApiSchema): z.ZodType {
  if (schema.enum) {
    return z.enum(schema.enum).describe(schema.description || "");
  }

  let zodString = z.string();
  if (schema.format === "email") {
    zodString = zodString.email();
  }
  // Early return preserves the "URI: " prefix; Zod's .describe() is immutable
  // so a subsequent .describe() call would overwrite it.
  if (schema.format === "uri") {
    return zodString.describe(`URI: ${schema.description || ""}`);
  }
  return zodString.describe(schema.description || "");
}

function convertNumberSchema(schema: OpenApiSchema): z.ZodType {
  let zodNumber = z.number();
  if (schema.minimum !== undefined) {
    zodNumber = zodNumber.min(schema.minimum);
  }
  if (schema.maximum !== undefined) {
    zodNumber = zodNumber.max(schema.maximum);
  }
  return zodNumber.describe(schema.description || "");
}

function buildObjectShape(
  schema: OpenApiSchema,
  fullSpec: OpenApiSpec
): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, prop] of Object.entries(schema.properties!)) {
    shape[key] = schema.required?.includes(key)
      ? openapiToZod(prop, fullSpec)
      : openapiToZod(prop, fullSpec).optional();
  }
  return shape;
}

function convertObjectSchema(schema: OpenApiSchema, fullSpec: OpenApiSpec): z.ZodType {
  if (!schema.properties) return z.record(z.any());
  return z.object(buildObjectShape(schema, fullSpec)).describe(schema.description || "");
}

// Handles schemas that omit `type` but use `properties`, `oneOf`, or `anyOf`
// — valid in OpenAPI but not covered by the type-based switch.
function convertUntypedSchema(schema: OpenApiSchema, fullSpec: OpenApiSpec): z.ZodType {
  if (schema.properties) {
    return z.object(buildObjectShape(schema, fullSpec)).describe(schema.description || "");
  }

  const variants = schema.oneOf ?? schema.anyOf;
  if (variants) {
    const unionTypes = variants.map((s) => openapiToZod(s, fullSpec));
    return z.union(unionTypes as [z.ZodType, z.ZodType, ...z.ZodType[]]).describe(schema.description || "");
  }

  return z.any().describe(schema.description || "");
}

export function resolveReference(ref: string, openApiSpec: OpenApiSpec): OpenApiSchema {
  const refPath = ref.replace("#/", "").split("/");
  return refPath.reduce<unknown>(
    (obj, segment) => (obj as Record<string, unknown>)[segment],
    openApiSpec
  ) as OpenApiSchema;
}

export function getOperationDetails(
  openApiSpec: OpenApiSpec,
  method: string,
  path: string
): OperationDetails | null {
  const lowerMethod = method.toLowerCase();

  if (!openApiSpec.paths?.[path]?.[lowerMethod]) {
    return null;
  }

  return {
    operation: openApiSpec.paths[path][lowerMethod] as OpenApiOperation,
    operationId: `${method}-${path.replace(/[^\w-]/g, "-").replace(/-+/g, "-")}`,
  };
}

export function getRequestContentType(operation: OpenApiOperation): string {
  if (!operation.requestBody?.content) return "application/x-www-form-urlencoded";

  if (operation.requestBody.content["application/json"]) return "application/json";

  // Use form-urlencoded even when the spec declares multipart/form-data,
  // since we don't support file uploads and sending a multipart Content-Type
  // without proper boundary encoding causes API errors.
  return "application/x-www-form-urlencoded";
}
