import type { z } from "zod";

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
