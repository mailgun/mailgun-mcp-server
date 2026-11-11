import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type ActiveTags, shouldRegister, type ToolClassification } from "../tags.js";
import type { ToolLoader } from "../toolsets.js";
import {
  TOOL_NAME as GET_METRICS_SUMMARY,
  register as registerGetMetricsSummary,
} from "./get-metrics-summary.js";
import {
  TOOL_NAME as GET_EMAIL_PREVIEW_QA,
  register as registerGetEmailPreviewQa,
} from "./get-email-preview-qa.js";
import {
  TOOL_NAME as RUN_EMAIL_PREVIEW_QA,
  register as registerRunEmailPreviewQa,
} from "./run-email-preview-qa.js";

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
  {
    name: GET_EMAIL_PREVIEW_QA,
    tags: ["inspect"],
    toolset: "inspect",
    core: false,
    readOnly: true,
    register: registerGetEmailPreviewQa,
  },
  {
    name: RUN_EMAIL_PREVIEW_QA,
    tags: ["inspect"],
    toolset: "inspect",
    core: false,
    // Creates a preview test and consumes quota.
    readOnly: false,
    register: registerRunEmailPreviewQa,
  },
];

export function registerCustomTools(
  server: McpServer,
  activeTags: ActiveTags,
  loader?: ToolLoader,
): void {
  for (const { name, register, ...classification } of customTools) {
    if (!shouldRegister(activeTags, classification)) continue;
    const handle = register(server, classification);
    loader?.add({ name, description: handle.description ?? "", ...classification, handle });
  }
}
