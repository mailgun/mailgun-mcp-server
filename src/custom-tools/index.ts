import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailgunConfig } from "../config.js";
import { type ActiveTags, shouldRegister, type ToolClassification } from "../tags.js";
import type { ToolDefinition } from "../tools.js";
import {
  TOOL_NAME as GET_METRICS_SUMMARY,
  register as registerGetMetricsSummary,
} from "./get-metrics-summary.js";

interface CustomToolManifestEntry extends ToolClassification {
  name: string;
  register: (
    server: McpServer,
    config: MailgunConfig,
    classification: ToolClassification,
  ) => RegisteredTool;
}

const customTools: readonly CustomToolManifestEntry[] = [
  {
    name: GET_METRICS_SUMMARY,
    tags: ["send"],
    toolset: "send.analytics",
    core: true,
    readOnly: true,
    register: registerGetMetricsSummary,
  },
];

export function buildCustomTools(activeTags: ActiveTags): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const { name, register, ...classification } of customTools) {
    if (!shouldRegister(activeTags, classification)) continue;
    tools.push({
      name,
      ...classification,
      register: (server, config) => register(server, config, classification),
    });
  }
  return tools;
}
