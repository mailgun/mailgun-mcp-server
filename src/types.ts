import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { MailgunConfig } from "./config.js";
import type { ToolClassification } from "./tags.js";

// --- OpenAPI spec ---

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  enum?: [string, ...string[]];
  minimum?: number;
  maximum?: number;
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

export interface OpenApiMediaType {
  schema: OpenApiSchema;
}

export interface OpenApiRequestBody {
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
}

export interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
  [method: string]: OpenApiOperation | undefined;
}

export interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// --- OpenAPI helper results ---

export interface OperationDetails {
  operation: OpenApiOperation;
  operationId: string;
}

export interface ParamsSchemaResult {
  paramsSchema: Record<string, z.ZodType>;
  keyMapping: Record<string, string>;
}

export interface PathParametersResult {
  actualPath: string;
  remainingParams: Record<string, unknown>;
}

export interface SeparatedParameters {
  queryParams: Record<string, unknown>;
  bodyParams: Record<string, unknown>;
}

// --- Tool catalog ---

// One tool, from the OpenAPI spec or a custom tool. Built once at startup.
// register() adds the tool to one server, bound to that server's config.
export interface ToolDefinition extends ToolClassification {
  name: string;
  register: (server: McpServer, config: MailgunConfig) => RegisteredTool;
}
