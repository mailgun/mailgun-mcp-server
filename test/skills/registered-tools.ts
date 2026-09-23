// Computes the full set of MCP tool names the server registers, mirroring the
// real registration paths: allowlisted OpenAPI endpoints plus custom tools.
// Shared by the skill drift and scenario tests.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadOpenApiSpec, getOperationDetails } from "../../src/openapi.js";
import { sanitizeToolId } from "../../src/schema.js";
import { endpoints, parseEndpointEntry } from "../../src/endpoints.js";
import { registerCustomTools } from "../../src/custom-tools/index.js";

export function collectRegisteredToolNames(): Set<string> {
  const names = new Set<string>();

  const spec = loadOpenApiSpec(new URL("../../src/openapi.yaml", import.meta.url).pathname);
  for (const entry of endpoints) {
    const { method, path, toolNameOverride } = parseEndpointEntry(entry);
    const details = getOperationDetails(spec, method, path);
    if (!details) continue;
    names.add(toolNameOverride ?? sanitizeToolId(details.operationId));
  }

  const stub = {
    registerTool: (name: string): void => {
      names.add(name);
    },
  };
  registerCustomTools(stub as unknown as McpServer);

  return names;
}
