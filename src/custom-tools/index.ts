import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ActiveTags, shouldRegister, type ToolClassification } from "../tags.js";
import type { ToolLoader } from "../toolsets.js";
import {
  TOOL_NAME as GET_METRICS_SUMMARY,
  register as registerGetMetricsSummary,
} from "./get-metrics-summary.js";

interface CustomToolManifestEntry extends ToolClassification {
  name: string;
  register: (server: McpServer, classification: ToolClassification) => RegisteredTool;
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

export function registerCustomTools(
  server: McpServer,
  activeTags: ActiveTags = "all",
  loader?: ToolLoader,
): void {
  for (const { name, register, ...classification } of customTools) {
    if (!shouldRegister(activeTags, classification)) continue;
    const handle = register(server, classification);
    loader?.add({ name, description: handle.description ?? "", ...classification, handle });
  }
}
