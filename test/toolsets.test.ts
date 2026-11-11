import { describe, test, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolClassification } from "../src/tags.js";
import { ToolLoader, toolsetHint } from "../src/toolsets.js";

type Fixture = [name: string, description: string, classification: Partial<ToolClassification>];

const fixtures: Fixture[] = [
  ["get-templates", "Get templates", { toolset: "send.templates", core: true }],
  ["create-template", "Create a template", { toolset: "send.templates", readOnly: false }],
  ["get-template", "Get template", { toolset: "send.templates" }],
  ["get-lists", "Get mailing lists", { toolset: "send.lists" }],
  [
    "validate_email",
    "Validate Address V4. Checks deliverability.",
    { tags: ["validate"], toolset: "validate", core: true },
  ],
];

function buildLoader(): { server: McpServer; loader: ToolLoader } {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const loader = new ToolLoader();
  for (const [name, description, classification] of fixtures) {
    const handle = server.registerTool(name, { description }, () => ({ content: [] }));
    loader.add({
      name,
      description,
      tags: ["send"],
      toolset: "send.templates",
      core: false,
      readOnly: true,
      ...classification,
      handle,
    });
  }
  return { server, loader };
}

const enabledNames = (loader: ToolLoader): string[] =>
  loader
    .summary()
    .flatMap((toolset) => toolset.tools)
    .filter((tool) => tool.enabled)
    .map((tool) => tool.name);

describe("ToolLoader.applyDefault()", () => {
  test("disables every non-core tool", () => {
    const { loader } = buildLoader();
    loader.applyDefault();
    expect(enabledNames(loader)).toEqual(["get-templates", "validate_email"]);
  });

  test("appends a toolset hint to core tools whose toolset has more tools", () => {
    const { loader } = buildLoader();
    loader.applyDefault();
    expect(loader.get("get-templates")!.handle.description).toBe(
      `Get templates ${toolsetHint("send.templates")}`,
    );
  });

  test("leaves core tools alone when their whole toolset is core", () => {
    const { loader } = buildLoader();
    loader.applyDefault();
    expect(loader.get("validate_email")!.handle.description).toBe(
      "Validate Address V4. Checks deliverability.",
    );
  });

  test("keeps the original description on the loaded tool", () => {
    const { loader } = buildLoader();
    loader.applyDefault();
    expect(loader.get("get-templates")!.description).toBe("Get templates");
  });
});

describe("ToolLoader.enable()", () => {
  test("enables the requested toolsets and returns the newly enabled tools", () => {
    const { loader } = buildLoader();
    loader.applyDefault();

    const enabled = loader.enable(["send.templates"]);

    expect(enabled.map((tool) => tool.name)).toEqual(["create-template", "get-template"]);
    expect(enabledNames(loader)).toEqual([
      "get-templates",
      "create-template",
      "get-template",
      "validate_email",
    ]);
  });

  test("returns nothing for toolsets that are already enabled", () => {
    const { loader } = buildLoader();
    loader.applyDefault();
    loader.enable(["send.templates"]);
    expect(loader.enable(["send.templates"])).toEqual([]);
  });
});

describe("ToolLoader.summary()", () => {
  test("lists every toolset, with one-sentence summaries and flags per tool", () => {
    const { loader } = buildLoader();
    loader.applyDefault();

    const summary = loader.summary();
    const templates = summary.find((toolset) => toolset.id === "send.templates")!;
    const validate = summary.find((toolset) => toolset.id === "validate")!;
    const routes = summary.find((toolset) => toolset.id === "send.routes")!;

    expect(templates.description).toBe("Templates and template versions");
    expect(templates.tools).toEqual([
      {
        name: "get-templates",
        summary: "Get templates",
        core: true,
        readOnly: true,
        enabled: true,
      },
      {
        name: "create-template",
        summary: "Create a template",
        core: false,
        readOnly: false,
        enabled: false,
      },
      {
        name: "get-template",
        summary: "Get template",
        core: false,
        readOnly: true,
        enabled: false,
      },
    ]);
    expect(validate.tools[0].summary).toBe("Validate Address V4");
    expect(routes.tools).toEqual([]);
  });
});

describe("ToolLoader.get()", () => {
  test("returns undefined for unknown names", () => {
    const { loader } = buildLoader();
    expect(loader.get("nope")).toBeUndefined();
  });
});
