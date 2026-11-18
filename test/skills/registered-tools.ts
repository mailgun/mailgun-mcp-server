// Computes the full set of MCP tool names the server registers, mirroring the
// real registration paths: allowlisted OpenAPI endpoints plus custom tools.
// Shared by the skill drift and scenario tests.

import { loadOpenApiSpec, getOperationDetails } from "../../src/openapi.js";
import { sanitizeToolId } from "../../src/schema.js";
import { endpoints, parseEndpointEntry } from "../../src/endpoints.js";
import { buildCustomTools } from "../../src/custom-tools/index.js";

export function collectRegisteredToolNames(): Set<string> {
  const names = new Set<string>();

  const spec = loadOpenApiSpec(new URL("../../src/openapi.yaml", import.meta.url).pathname);
  for (const entry of endpoints) {
    const { method, path, toolNameOverride } = parseEndpointEntry(entry);
    const details = getOperationDetails(spec, method, path);
    if (!details) continue;
    names.add(toolNameOverride ?? sanitizeToolId(details.operationId));
  }

  for (const tool of buildCustomTools("all")) names.add(tool.name);

  return names;
}
