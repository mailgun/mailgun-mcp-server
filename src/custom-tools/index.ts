import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as registerGetMetricsSummary } from "./get-metrics-summary.js";

export function registerCustomTools(server: McpServer): void {
  registerGetMetricsSummary(server);
}
