import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  type CallToolResult,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { makeMailgunRequest } from "../src/api.js";
import { loadOpenApiSpec } from "../src/openapi.js";
import { createMailgunServer, registerMailgunTools } from "../src/server.js";
import type { ActiveTags } from "../src/tags.js";
import { toolsetHint } from "../src/toolsets.js";

vi.mock("../src/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/api.js")>()),
  makeMailgunRequest: vi.fn<() => Promise<unknown>>(async () => ({ items: [] })),
}));

const openApiSpec = loadOpenApiSpec(new URL("../src/openapi.yaml", import.meta.url).pathname);

const CORE_TOOLS = [
  "get-v3-domain-bounces",
  "get-v3-domain-bounces-address",
  "get-v3-domain-complaints",
  "get-v3-domain-templates",
  "get-v3-domain-unsubscribes",
  "get-v3-domains-name-tracking",
  "get-v4-domains",
  "get-v4-domains-name",
  "get_metrics_summary",
  "post-v1-analytics-logs",
  "post-v1-analytics-metrics",
  "post-v2-bounce-classification-metrics",
  "post-v3-domain-messages",
  "put-v4-domains-name-verify",
  "validate_email",
];
const META_TOOLS = ["mailgun_call_tool", "mailgun_enable_toolset", "mailgun_list_toolsets"];
const TEMPLATE_TOOLS = [
  "get-v3-domain-templates",
  "get-v3-domain-templates-template",
  "get-v3-domain-templates-template-versions",
  "get-v3-domain-templates-template-versions-version",
  "post-v3-domain-templates",
  "post-v3-domain-templates-template-versions",
  "put-v3-domain-templates-template",
  "put-v3-domain-templates-template-versions-version",
];

// Serialized tools/list budget for dynamic mode, so the footprint can't silently grow back.
const DYNAMIC_MODE_BYTE_BUDGET = 31_000;

let client: Client;
let listChangedCount: number;

async function connect(activeTags: ActiveTags): Promise<void> {
  const server = createMailgunServer();
  registerMailgunTools(server, openApiSpec, activeTags);
  client = new Client({ name: "test-client", version: "0.0.0" });
  listChangedCount = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listChangedCount += 1;
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
}

async function toolNames(): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((tool) => tool.name).toSorted();
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

const text = (result: CallToolResult): string =>
  result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");

// Lets pending notifications reach the client before asserting on them.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.mocked(makeMailgunRequest).mockClear();
});

afterEach(async () => {
  await client.close();
});

describe("dynamic mode", () => {
  beforeEach(() => connect("dynamic"));

  test("lists only the core tools and the meta-tools", async () => {
    expect(await toolNames()).toEqual([...CORE_TOOLS, ...META_TOOLS].toSorted());
  });

  test("stays under the tools/list byte budget", async () => {
    const { tools } = await client.listTools();
    expect(JSON.stringify(tools).length).toBeLessThan(DYNAMIC_MODE_BYTE_BUDGET);
  });

  test("hints at more tools only on core tools whose toolset has them", async () => {
    const { tools } = await client.listTools();
    const description = (name: string) => tools.find((tool) => tool.name === name)!.description;
    expect(description("get-v3-domain-templates")).toBe(
      `Get templates ${toolsetHint("send.templates")}`,
    );
    expect(description("validate_email")).toBe("Validate Address V4");
  });

  test("marks every tool with readOnlyHint", async () => {
    const { tools } = await client.listTools();
    const writes = tools.filter((tool) => tool.annotations?.readOnlyHint === false);
    expect(writes.map((tool) => tool.name)).toEqual([
      "post-v3-domain-messages",
      "put-v4-domains-name-verify",
      "mailgun_enable_toolset",
    ]);
    expect(tools.find((tool) => tool.name === "mailgun_enable_toolset")!.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(tools.every((tool) => typeof tool.annotations?.readOnlyHint === "boolean")).toBe(true);
  });

  test("puts the toolset catalog in the mailgun_enable_toolset description", async () => {
    const { tools } = await client.listTools();
    const enable = tools.find((tool) => tool.name === "mailgun_enable_toolset")!;
    expect(enable.description).toContain("- send.lists: Mailing lists and list members");
    expect(enable.description).toContain(
      "- inspect: Email preview QA: run and resume tests, client renders, check results",
    );
  });
});

describe("mailgun_list_toolsets", () => {
  beforeEach(() => connect("dynamic"));

  test("lists every toolset with per-tool summaries and markers", async () => {
    const output = text(await call("mailgun_list_toolsets"));
    expect(output).toContain("send.templates: Templates and template versions");
    expect(output).toContain("  * get-v3-domain-templates: Get templates");
    expect(output).toContain("    post-v3-domain-templates [write]: Create a template");
    expect(output).toContain("    get-v3-routes: Get all routes");
  });

  test("marks tools as loaded after their toolset is enabled", async () => {
    await call("mailgun_enable_toolset", { toolsets: ["send.routes"] });
    const output = text(await call("mailgun_list_toolsets"));
    expect(output).toContain("  * get-v3-routes: Get all routes");
  });

  test("returns a tool's input schema when given its name", async () => {
    const details = (name: string) =>
      call("mailgun_list_toolsets", { tool: name }).then((result) => JSON.parse(text(result)));
    const getTemplate = await details("get-v3-domain-templates-template");
    const createTemplate = await details("post-v3-domain-templates");
    await call("mailgun_enable_toolset", { toolsets: ["send.templates"] });
    const listed = (await client.listTools()).tools.find(
      (tool) => tool.name === "get-v3-domain-templates-template",
    )!;

    expect(getTemplate).toEqual({
      name: "get-v3-domain-templates-template",
      description: listed.description,
      inputSchema: listed.inputSchema,
    });
    expect(createTemplate.write).toBe(true);
  });

  test("rejects an unknown tool name", async () => {
    const result = await call("mailgun_list_toolsets", { tool: "nope" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/Unknown tool "nope"/);
  });
});

describe("mailgun_enable_toolset", () => {
  beforeEach(() => connect("dynamic"));

  test("loads a toolset and sends a single list_changed notification", async () => {
    const result = await call("mailgun_enable_toolset", { toolsets: ["send.templates"] });
    await flush();

    expect(result.isError).toBeUndefined();
    expect(listChangedCount).toBe(1);
    expect(await toolNames()).toEqual(
      [...new Set([...CORE_TOOLS, ...META_TOOLS, ...TEMPLATE_TOOLS])].toSorted(),
    );
  });

  test("lists the newly loaded tools without their input schemas", async () => {
    const output = text(await call("mailgun_enable_toolset", { toolsets: ["send.templates"] }));
    const tools = output.split("\n").filter((line) => line.startsWith("- "));

    expect(output).toMatch(/^Loaded 7 tools from send\.templates\./);
    expect(tools).toHaveLength(7);
    expect(tools).toContain("- post-v3-domain-templates [write]: Create a template");
    expect(tools.some((line) => line.startsWith("- get-v3-domain-templates:"))).toBe(false);
    expect(output).not.toContain("inputSchema");
  });

  test("uses the singular when one tool is loaded", async () => {
    const output = text(await call("mailgun_enable_toolset", { toolsets: ["optimize"] }));
    expect(output).toMatch(/^Loaded 1 tool from optimize\./);
  });

  test("tells the model how to reach write tools a client doesn't show", async () => {
    const output = text(await call("mailgun_enable_toolset", { toolsets: ["send.templates"] }));
    expect(output).toContain("--tags core,send.templates");
  });

  test("sends one notification for several toolsets", async () => {
    await call("mailgun_enable_toolset", { toolsets: ["send.lists", "send.routes"] });
    await flush();
    expect(listChangedCount).toBe(1);
  });

  test("loads nothing and sends no notification for an already loaded toolset", async () => {
    await call("mailgun_enable_toolset", { toolsets: ["validate"] });
    await flush();
    expect(listChangedCount).toBe(0);
  });

  test("rejects unknown toolsets", async () => {
    const result = await call("mailgun_enable_toolset", { toolsets: ["send.nope"] });
    expect(result.isError).toBe(true);
    expect(listChangedCount).toBe(0);
  });
});

describe("mailgun_call_tool", () => {
  beforeEach(() => connect("dynamic"));

  test("runs a read-only tool that isn't loaded", async () => {
    const result = await call("mailgun_call_tool", {
      name: "get-v3-domains-domain-webhooks",
      arguments: { domain: "example.com" },
    });

    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("GET /v3/domains/example.com/webhooks completed successfully");
    expect(makeMailgunRequest).toHaveBeenCalledWith(
      "GET",
      "/v3/domains/example.com/webhooks",
      null,
      expect.any(String),
    );
  });

  test("runs a query-only POST tool", async () => {
    const result = await call("mailgun_call_tool", {
      name: "post-v1-analytics-usage-metrics",
      arguments: {},
    });
    expect(result.isError).toBeUndefined();
    expect(makeMailgunRequest).toHaveBeenCalledWith(
      "POST",
      "/v1/analytics/usage/metrics",
      {},
      "application/json",
    );
  });

  test.each([
    ["an unknown tool", "nope", /Unknown tool "nope"/],
    ["a meta-tool", "mailgun_list_toolsets", /Unknown tool "mailgun_list_toolsets"/],
    ["a core tool", "get-v4-domains", /already in your tool list/],
    ["a write tool", "post-v3-lists", /changes data.*--tags core,send\.lists/],
    ["the core send tool", "post-v3-domain-messages", /already in your tool list/],
  ])("refuses %s without calling Mailgun", async (_label, name, message) => {
    const result = await call("mailgun_call_tool", { name, arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(message);
    expect(makeMailgunRequest).not.toHaveBeenCalled();
  });

  test("refuses invalid arguments and points to the schema", async () => {
    const result = await call("mailgun_call_tool", {
      name: "get-v3-domains-domain-webhooks",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Invalid arguments for get-v3-domains-domain-webhooks");
    expect(text(result)).toContain(
      'mailgun_list_toolsets with tool "get-v3-domains-domain-webhooks"',
    );
    expect(makeMailgunRequest).not.toHaveBeenCalled();
  });
});

describe("static modes", () => {
  test.each<[string, ActiveTags, number]>([
    ["all", "all", 83],
    ["send", new Set(["send"]), 70],
    ["core", new Set(["core"]), 15],
    ["send.templates", new Set(["send.templates"]), 8],
    ["validate,inspect", new Set(["validate", "inspect"]), 12],
  ])("--tags %s registers %i tools and no meta-tools", async (_label, activeTags, count) => {
    await connect(activeTags);
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(count);
    expect(tools.filter((tool) => tool.name.startsWith("mailgun_"))).toEqual([]);
    expect(tools.filter((tool) => tool.description?.includes("mailgun_enable_toolset"))).toEqual(
      [],
    );
  });
});
