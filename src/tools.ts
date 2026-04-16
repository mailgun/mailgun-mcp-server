import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type {
  OpenApiOperation,
  OpenApiSpec,
  PathParametersResult,
  SeparatedParameters,
} from "./types.js";
import { endpoints } from "./endpoints.js";
import { makeMailgunRequest } from "./api.js";
import { getOperationDetails, getRequestContentType } from "./openapi.js";
import { buildParamsSchema, sanitizeToolId } from "./schema.js";

export function generateToolsFromOpenApi(openApiSpec: OpenApiSpec, server: McpServer): void {
  for (const endpoint of endpoints) {
    try {
      const [method, path] = endpoint.split(" ");
      const operationDetails = getOperationDetails(openApiSpec, method, path);

      if (!operationDetails) {
        console.warn(`Could not match endpoint: ${method} ${path} in OpenAPI spec`);
        continue;
      }

      const { operation, operationId } = operationDetails;
      const { paramsSchema, keyMapping } = buildParamsSchema(operation, openApiSpec);
      const toolId = sanitizeToolId(operationId);
      const toolDescription = operation.summary || `${method.toUpperCase()} ${path}`;
      const contentType = getRequestContentType(operation);

      registerTool(
        server,
        toolId,
        toolDescription,
        paramsSchema,
        method,
        path,
        operation,
        contentType,
        keyMapping,
      );
    } catch (error) {
      console.error(`Failed to process endpoint ${endpoint}: ${(error as Error).message}`);
    }
  }
}

export function registerTool(
  server: McpServer,
  toolId: string,
  toolDescription: string,
  paramsSchema: Record<string, z.ZodType>,
  method: string,
  path: string,
  operation: OpenApiOperation,
  contentType: string,
  keyMapping: Record<string, string> = {},
): void {
  const httpMethod = method.toUpperCase();
  server.registerTool(
    toolId,
    {
      description: toolDescription,
      inputSchema: paramsSchema,
    },
    async (params) => {
      try {
        const originalParams: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
          const originalKey = keyMapping[key] || key;
          originalParams[originalKey] = value;
        }

        const { actualPath, remainingParams } = processPathParameters(
          path,
          operation,
          originalParams,
        );
        const { queryParams, bodyParams } = separateParameters(remainingParams, operation, method);
        const finalPath = appendQueryString(actualPath, queryParams);

        const result = await makeMailgunRequest(
          httpMethod,
          finalPath,
          httpMethod === "GET" ? null : bodyParams,
          contentType,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `${httpMethod} ${finalPath} completed successfully:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}

export function processPathParameters(
  path: string,
  operation: OpenApiOperation,
  params: Record<string, unknown>,
): PathParametersResult {
  let actualPath = path;
  const pathParams = operation.parameters?.filter((p) => p.in === "path") || [];
  const remainingParams: Record<string, unknown> = { ...params };

  for (const param of pathParams) {
    if (param.name in params && params[param.name] !== undefined) {
      actualPath = actualPath.replace(
        `{${param.name}}`,
        encodeURIComponent(String(params[param.name])),
      );
      delete remainingParams[param.name];
    } else {
      throw new Error(`Required path parameter '${param.name}' is missing`);
    }
  }

  return { actualPath, remainingParams };
}

export function separateParameters(
  params: Record<string, unknown>,
  operation: OpenApiOperation,
  method: string,
): SeparatedParameters {
  if (method.toUpperCase() === "GET") {
    return { queryParams: { ...params }, bodyParams: {} };
  }

  const queryParams: Record<string, unknown> = {};
  const bodyParams: Record<string, unknown> = {};
  const definedQueryParams = new Set(
    operation.parameters?.filter((p) => p.in === "query").map((p) => p.name),
  );

  for (const [key, value] of Object.entries(params)) {
    if (definedQueryParams.has(key)) {
      queryParams[key] = value;
    } else {
      bodyParams[key] = value;
    }
  }

  return { queryParams, bodyParams };
}

export function appendQueryString(path: string, queryParams: Record<string, unknown>): string {
  const queryString = new URLSearchParams();

  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      queryString.append(key, String(value));
    }
  }

  const qs = queryString.toString();
  if (!qs) {
    return path;
  }

  return `${path}?${qs}`;
}
