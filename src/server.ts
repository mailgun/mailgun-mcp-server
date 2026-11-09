import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailgunConfig } from "./config.js";
import { buildCustomTools } from "./custom-tools/index.js";
import type { ActiveTags } from "./tags.js";
import { buildOpenApiTools, type ToolDefinition } from "./tools.js";
import { registerMetaTools, ToolLoader } from "./toolsets.js";
import type { OpenApiSpec } from "./types.js";
import { PACKAGE_VERSION } from "./version.js";

// Every tool the server exposes, built once at startup and shared by all server instances.
export interface ToolCatalog {
  readonly tools: readonly ToolDefinition[];
  readonly dynamic: boolean;
}

export function buildToolCatalog(openApiSpec: OpenApiSpec, activeTags: ActiveTags): ToolCatalog {
  return {
    tools: [...buildOpenApiTools(openApiSpec, activeTags), ...buildCustomTools(activeTags)],
    dynamic: activeTags === "dynamic",
  };
}

// Creates a server whose tools only ever use this config: once for stdio, once per request
// when hosted. Registration only stores references to the catalog, so this is cheap.
export function createMailgunServer(catalog: ToolCatalog, config: MailgunConfig): McpServer {
  const server = new McpServer(
    { name: "mailgun", version: PACKAGE_VERSION },
    { debouncedNotificationMethods: ["notifications/tools/list_changed"] },
  );
  const loader = catalog.dynamic ? new ToolLoader() : undefined;

  for (const { name, register, ...classification } of catalog.tools) {
    const handle = register(server, config);
    loader?.add({ name, description: handle.description ?? "", ...classification, handle });
  }

  if (loader) {
    loader.applyDefault();
    registerMetaTools(server, loader);
  }
  return server;
}
