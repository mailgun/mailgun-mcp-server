import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TOOLSET_IDS, TOOLSETS, type ToolClassification, type ToolsetId } from "./tags.js";

export const LIST_TOOLSETS = "mailgun_list_toolsets";
export const ENABLE_TOOLSET = "mailgun_enable_toolset";
export const CALL_TOOL = "mailgun_call_tool";

export interface LoadedTool extends ToolClassification {
  name: string;
  // Description before the toolset hint is added.
  description: string;
  handle: RegisteredTool;
}

export interface ToolsetSummary {
  id: ToolsetId;
  description: string;
  tools: {
    name: string;
    summary: string;
    core: boolean;
    readOnly: boolean;
    enabled: boolean;
  }[];
}

function firstSentence(text: string): string {
  return text.split(/\.\s/)[0];
}

export function toolsetHint(toolset: ToolsetId): string {
  return `Related tools in toolset "${toolset}" can be loaded with ${ENABLE_TOOLSET}.`;
}

// Keeps the SDK handle of every tool registered in dynamic mode, keyed by name.
export class ToolLoader {
  private readonly tools = new Map<string, LoadedTool>();

  add(tool: LoadedTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): LoadedTool | undefined {
    return this.tools.get(name);
  }

  // Disables every non-core tool and points core tools at the rest of their toolset.
  // Must run before server.connect(), so clients never see the full tool list.
  applyDefault(): void {
    for (const tool of this.tools.values()) {
      if (!tool.core) {
        tool.handle.disable();
      } else if (this.inToolset(tool.toolset).some((t) => !t.core)) {
        tool.handle.update({ description: `${tool.description} ${toolsetHint(tool.toolset)}` });
      }
    }
  }

  enable(toolsets: readonly ToolsetId[]): LoadedTool[] {
    const newlyEnabled: LoadedTool[] = [];
    for (const tool of this.tools.values()) {
      if (toolsets.includes(tool.toolset) && !tool.handle.enabled) {
        tool.handle.enable();
        newlyEnabled.push(tool);
      }
    }
    return newlyEnabled;
  }

  summary(): ToolsetSummary[] {
    return TOOLSET_IDS.map((id) => ({
      id,
      description: TOOLSETS[id],
      tools: this.inToolset(id).map((tool) => ({
        name: tool.name,
        summary: firstSentence(tool.description),
        core: tool.core,
        readOnly: tool.readOnly,
        enabled: tool.handle.enabled,
      })),
    }));
  }

  private inToolset(toolset: ToolsetId): LoadedTool[] {
    return [...this.tools.values()].filter((tool) => tool.toolset === toolset);
  }
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// The SDK types handlers as a union over every tool shape; every tool registered
// here takes (args, extra), or only (extra) when it has no input schema.
type ToolHandler = (...args: unknown[]) => CallToolResult | Promise<CallToolResult>;

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError && { isError }) };
}

function configHint(toolset: ToolsetId): string {
  return `ask the user to set --tags core,${toolset} (or MAILGUN_MCP_TAGS) in the Mailgun MCP server configuration`;
}

export function formatToolsetSummary(summaries: readonly ToolsetSummary[]): string {
  const lines = [
    `Mailgun toolsets. Load one with ${ENABLE_TOOLSET}. "*" = already loaded, [write] = changes data.`,
  ];
  for (const toolset of summaries) {
    lines.push("", `${toolset.id}: ${toolset.description}`);
    for (const tool of toolset.tools) {
      const marker = tool.enabled ? "*" : " ";
      const write = tool.readOnly ? "" : " [write]";
      lines.push(`  ${marker} ${tool.name}${write}: ${tool.summary}`);
    }
  }
  return lines.join("\n");
}

// Every tool here is registered with zod 4 schemas; the SDK types them as zod 3 or 4.
function inputSchemaOf(handle: RegisteredTool): z.core.$ZodType | undefined {
  return handle.inputSchema as z.core.$ZodType | undefined;
}

// Same options the SDK uses for tools/list, so both return the same schema.
function inputJsonSchema(handle: RegisteredTool): unknown {
  const schema = inputSchemaOf(handle);
  return schema
    ? z.toJSONSchema(schema, { target: "draft-7", io: "input" })
    : { type: "object", properties: {} };
}

// Names and summaries only: clients that refresh their tool list get the schemas from it,
// so returning them here too would put them in the model's context twice.
function enableResult(toolsets: readonly ToolsetId[], loaded: readonly LoadedTool[]): string {
  if (loaded.length === 0) {
    return `Nothing new to load: ${toolsets.join(", ")} already loaded.`;
  }
  const plural = loaded.length === 1 ? "tool" : "tools";
  const lines = [
    `Loaded ${loaded.length} ${plural} from ${toolsets.join(", ")}. They should now appear in your tool list.`,
    `If they don't, run the read-only ones with ${CALL_TOOL}, after getting each one's input schema from ${LIST_TOOLSETS}.`,
  ];
  const writeToolsets = [...new Set(loaded.filter((t) => !t.readOnly).map((t) => t.toolset))];
  for (const toolset of writeToolsets) {
    lines.push(
      `Tools marked [write] in ${toolset} can only be called directly; if they don't appear, ${configHint(toolset)}.`,
    );
  }
  lines.push("");
  for (const tool of loaded) {
    const write = tool.readOnly ? "" : " [write]";
    lines.push(`- ${tool.name}${write}: ${firstSentence(tool.description)}`);
  }
  return lines.join("\n");
}

function toolDetails(loader: ToolLoader, name: string): CallToolResult {
  const tool = loader.get(name);
  if (!tool) {
    return textResult(
      `Unknown tool "${name}". Call ${LIST_TOOLSETS} without a tool name to see tool names.`,
      true,
    );
  }
  return textResult(
    JSON.stringify({
      name: tool.name,
      ...(!tool.readOnly && { write: true }),
      description: tool.description,
      inputSchema: inputJsonSchema(tool.handle),
    }),
  );
}

async function callTool(
  loader: ToolLoader,
  name: string,
  args: Record<string, unknown>,
  extra: Extra,
): Promise<CallToolResult> {
  const tool = loader.get(name);
  if (!tool) {
    return textResult(`Unknown tool "${name}". Call ${LIST_TOOLSETS} to see tool names.`, true);
  }
  if (tool.core) {
    return textResult(`"${name}" is already in your tool list; call it directly.`, true);
  }
  if (!tool.readOnly) {
    return textResult(
      `"${name}" changes data, so it can't be run through ${CALL_TOOL}. Load its toolset with ` +
        `${ENABLE_TOOLSET} and call it directly; if it doesn't appear in your tool list, ` +
        `${configHint(tool.toolset)}.`,
      true,
    );
  }

  const handler = tool.handle.handler as unknown as ToolHandler;
  const schema = inputSchemaOf(tool.handle);
  if (!schema) return handler(extra);

  const parsed = await z.safeParseAsync(schema, args);
  if (!parsed.success) {
    return textResult(
      `Invalid arguments for ${name}: ${parsed.error.message}. ` +
        `Call ${LIST_TOOLSETS} with tool "${name}" to get its input schema.`,
      true,
    );
  }
  return handler(parsed.data, extra);
}

export function registerMetaTools(server: McpServer, loader: ToolLoader): void {
  server.registerTool(
    LIST_TOOLSETS,
    {
      description:
        "List the Mailgun toolsets and every tool in them, including tools that aren't loaded yet. " +
        "Use this when a task needs a Mailgun capability you don't see in your tools. " +
        "Pass a tool name to get that tool's input schema instead.",
      inputSchema: {
        tool: z
          .string()
          .optional()
          .describe("Tool name, for example get-v3-domain-templates-template."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ tool }) =>
      tool ? toolDetails(loader, tool) : textResult(formatToolsetSummary(loader.summary())),
  );

  const catalog = TOOLSET_IDS.map((id) => `- ${id}: ${TOOLSETS[id]}`).join("\n");
  server.registerTool(
    ENABLE_TOOLSET,
    {
      description:
        "Load more Mailgun tools. Only a small core set is loaded at startup; the rest are grouped " +
        `into these toolsets:\n${catalog}\nReturns the names of the loaded tools. ` +
        `Call ${LIST_TOOLSETS} to see the tools in each toolset.`,
      inputSchema: {
        toolsets: z
          .array(z.enum(TOOLSET_IDS))
          .min(1)
          .describe('Toolset IDs to load, for example ["send.templates"].'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ toolsets }) => textResult(enableResult(toolsets, loader.enable(toolsets))),
  );

  server.registerTool(
    CALL_TOOL,
    {
      description:
        "Run a read-only Mailgun tool by name, whether or not its toolset is loaded. Use it only " +
        "for tools that aren't in your tool list; otherwise call the tool directly. " +
        `${LIST_TOOLSETS} returns each tool's input schema. Core tools and tools that change ` +
        "data can't be run this way.",
      inputSchema: {
        name: z.string().describe("Tool name, for example get-v3-domain-templates-template."),
        arguments: z
          .record(z.string(), z.unknown())
          // Serializes as `additionalProperties: true` instead of `{}`, which some clients reject.
          .meta({ additionalProperties: true })
          .optional()
          .describe("Arguments for the tool, matching its input schema."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ name, arguments: args }, extra) => callTool(loader, name, args ?? {}, extra),
  );
}
