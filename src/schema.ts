import type { z } from "zod";
import type {
  OpenApiOperation,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiSchema,
  OpenApiSpec,
  ParamsSchemaResult,
} from "./types.js";
import { openapiToZod, resolveReference } from "./openapi.js";

export function sanitizePropertyKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
}

export function sanitizeToolId(operationId: string): string {
  return operationId
    .replace(/[^\w-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 64);
}

export function buildParamsSchema(
  operation: OpenApiOperation,
  openApiSpec: OpenApiSpec
): ParamsSchemaResult {
  const paramsSchema: Record<string, z.ZodType> = {};
  const keyMapping: Record<string, string> = {};

  const pathParams = operation.parameters?.filter((p) => p.in === "path") || [];
  processParameters(pathParams, paramsSchema, openApiSpec, keyMapping);

  const queryParams = operation.parameters?.filter((p) => p.in === "query") || [];
  processParameters(queryParams, paramsSchema, openApiSpec, keyMapping);

  if (operation.requestBody) {
    processRequestBody(operation.requestBody, paramsSchema, openApiSpec, keyMapping);
  }

  return { paramsSchema, keyMapping };
}

export function processParameters(
  parameters: OpenApiParameter[],
  paramsSchema: Record<string, z.ZodType>,
  openApiSpec: OpenApiSpec,
  keyMapping: Record<string, string> = {}
): void {
  for (const param of parameters) {
    const sanitizedKey = sanitizePropertyKey(param.name);
    if (sanitizedKey !== param.name) {
      keyMapping[sanitizedKey] = param.name;
    }
    const schema = param.description && !param.schema?.description
      ? { ...param.schema, description: param.description }
      : param.schema;
    const zodParam = openapiToZod(schema, openApiSpec);
    paramsSchema[sanitizedKey] = param.required ? zodParam : zodParam.optional();
  }
}

export function processRequestBody(
  requestBody: OpenApiRequestBody,
  paramsSchema: Record<string, z.ZodType>,
  openApiSpec: OpenApiSpec,
  keyMapping: Record<string, string> = {}
): void {
  if (!requestBody.content) return;

  const contentTypes = [
    "application/json",
    "multipart/form-data",
    "application/x-www-form-urlencoded",
  ] as const;

  for (const contentType of contentTypes) {
    if (!requestBody.content[contentType]) continue;

    let bodySchema: OpenApiSchema = requestBody.content[contentType].schema;

    if (bodySchema.$ref) {
      bodySchema = resolveReference(bodySchema.$ref, openApiSpec);
    }

    if (bodySchema?.properties) {
      for (const [prop, schema] of Object.entries(bodySchema.properties)) {
        let propSchema: OpenApiSchema = schema;

        if (propSchema.$ref) {
          propSchema = resolveReference(propSchema.$ref, openApiSpec);
        }

        const sanitizedKey = sanitizePropertyKey(prop);
        if (sanitizedKey !== prop) {
          keyMapping[sanitizedKey] = prop;
        }

        const zodProp = openapiToZod(propSchema, openApiSpec);
        paramsSchema[sanitizedKey] = bodySchema.required?.includes(prop)
          ? zodProp
          : zodProp.optional();
      }
    }

    break;
  }
}
