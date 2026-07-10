import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ActiveTags, shouldRegister, type Tag } from "../tags.js";
import { register as registerGetMetricsSummary } from "./get-metrics-summary.js";
import { register as registerGetEmailPreviewQa } from "./get-email-preview-qa.js";
import { register as registerRunEmailPreviewQa } from "./run-email-preview-qa.js";

interface CustomToolManifestEntry {
  tags: readonly Tag[];
  register: (server: McpServer, tags: readonly Tag[]) => void;
}

const customTools: readonly CustomToolManifestEntry[] = [
  { tags: ["send"], register: registerGetMetricsSummary },
  { tags: ["inspect"], register: registerGetEmailPreviewQa },
  { tags: ["inspect"], register: registerRunEmailPreviewQa },
];

export function registerCustomTools(server: McpServer, activeTags: ActiveTags = "all"): void {
  for (const { tags, register } of customTools) {
    if (!shouldRegister(activeTags, tags)) continue;
    register(server, tags);
  }
}
