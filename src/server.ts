import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCustomTools } from "./custom-tools/index.js";
import type { ActiveTags } from "./tags.js";
import { generateToolsFromOpenApi } from "./tools.js";
import { registerMetaTools, ToolLoader } from "./toolsets.js";
import type { OpenApiSpec } from "./types.js";
import { PACKAGE_VERSION } from "./version.js";

export function createMailgunServer(): McpServer {
  return new McpServer(
    { name: "mailgun", version: PACKAGE_VERSION },
    { debouncedNotificationMethods: ["notifications/tools/list_changed"] },
  );
}

export function registerMailgunTools(
  server: McpServer,
  openApiSpec: OpenApiSpec,
  activeTags: ActiveTags,
): void {
  const loader = activeTags === "dynamic" ? new ToolLoader() : undefined;
  generateToolsFromOpenApi(openApiSpec, server, activeTags, loader);
  registerCustomTools(server, activeTags, loader);

  if (loader) {
    loader.applyDefault();
    registerMetaTools(server, loader);
  }
}
