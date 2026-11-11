import { describe, test, expect } from "vitest";
import {
  KNOWN_TAG_SELECTORS,
  KNOWN_TAGS,
  parseTagList,
  shouldRegister,
  TOOLSET_IDS,
  type ToolClassification,
  toolsetTag,
} from "../src/tags.js";

const tool = (overrides: Partial<ToolClassification> = {}): ToolClassification => ({
  tags: ["send"],
  toolset: "send.templates",
  core: false,
  readOnly: true,
  ...overrides,
});

describe("parseTagList()", () => {
  test("returns empty result for an empty string", () => {
    expect(parseTagList("")).toEqual({ tags: [], invalid: [] });
  });

  test("returns empty result for whitespace and empty segments", () => {
    expect(parseTagList("  , , ,")).toEqual({ tags: [], invalid: [] });
  });

  test("trims and lowercases known tags", () => {
    const result = parseTagList("  Send ,VALIDATE,  inspect  ");
    expect(result.tags).toEqual(["send", "validate", "inspect"]);
    expect(result.invalid).toEqual([]);
  });

  test("preserves first-occurrence order", () => {
    const result = parseTagList("inspect,validate,send");
    expect(result.tags).toEqual(["inspect", "validate", "send"]);
  });

  test("dedupes repeated entries", () => {
    const result = parseTagList("send,validate,send,validate,SEND");
    expect(result.tags).toEqual(["send", "validate"]);
    expect(result.invalid).toEqual([]);
  });

  test("collects unknown tags separately", () => {
    const result = parseTagList("send,foo,bar,validate");
    expect(result.tags).toEqual(["send", "validate"]);
    expect(result.invalid).toEqual(["foo", "bar"]);
  });

  test("dedupes unknown tags", () => {
    const result = parseTagList("foo,foo,FOO,bar,bar");
    expect(result.invalid).toEqual(["foo", "bar"]);
  });

  test("recognizes every value in KNOWN_TAGS", () => {
    const result = parseTagList(KNOWN_TAGS.join(","));
    expect(result.tags).toEqual([...KNOWN_TAGS]);
    expect(result.invalid).toEqual([]);
  });
});

describe("parseTagList() selectors", () => {
  test("accepts toolset IDs, core, and all", () => {
    const result = parseTagList("send.templates, CORE, all, validate");
    expect(result.tags).toEqual(["send.templates", "core", "all", "validate"]);
    expect(result.invalid).toEqual([]);
  });

  test("rejects unknown toolset IDs", () => {
    const result = parseTagList("send.nope,send.");
    expect(result.tags).toEqual([]);
    expect(result.invalid).toEqual(["send.nope", "send."]);
  });

  test("recognizes every value in KNOWN_TAG_SELECTORS", () => {
    const result = parseTagList(KNOWN_TAG_SELECTORS.join(","));
    expect(result.tags).toEqual([...KNOWN_TAG_SELECTORS]);
    expect(result.invalid).toEqual([]);
  });
});

describe("toolsetTag()", () => {
  test("maps every toolset to a known product tag", () => {
    expect(toolsetTag("send.templates")).toBe("send");
    expect(toolsetTag("validate")).toBe("validate");
    for (const id of TOOLSET_IDS) {
      expect(KNOWN_TAGS).toContain(toolsetTag(id));
    }
  });
});

describe("shouldRegister()", () => {
  test('"dynamic" and "all" always register', () => {
    expect(shouldRegister("dynamic", tool())).toBe(true);
    expect(shouldRegister("all", tool())).toBe(true);
    expect(shouldRegister("all", tool({ tags: ["validate"], toolset: "validate" }))).toBe(true);
  });

  test("registers when entry tags intersect active set", () => {
    const active = new Set(["send", "validate"] as const);
    expect(shouldRegister(active, tool())).toBe(true);
    expect(shouldRegister(active, tool({ tags: ["validate"], toolset: "validate" }))).toBe(true);
  });

  test("does not register when entry tags are disjoint", () => {
    const active = new Set(["send"] as const);
    expect(shouldRegister(active, tool({ tags: ["validate"], toolset: "validate" }))).toBe(false);
    expect(shouldRegister(active, tool({ tags: ["inspect"], toolset: "inspect" }))).toBe(false);
  });

  test("a product tag matches every toolset under it", () => {
    const active = new Set(["send"] as const);
    expect(shouldRegister(active, tool({ toolset: "send.templates" }))).toBe(true);
    expect(shouldRegister(active, tool({ toolset: "send.lists" }))).toBe(true);
  });

  test("a toolset ID matches only that toolset", () => {
    const active = new Set(["send.templates"] as const);
    expect(shouldRegister(active, tool({ toolset: "send.templates" }))).toBe(true);
    expect(shouldRegister(active, tool({ toolset: "send.lists" }))).toBe(false);
  });

  test("core matches only core tools", () => {
    const active = new Set(["core"] as const);
    expect(shouldRegister(active, tool({ core: true }))).toBe(true);
    expect(shouldRegister(active, tool({ core: false }))).toBe(false);
  });

  test("selectors combine with OR semantics", () => {
    const active = new Set(["core", "send.lists"] as const);
    expect(shouldRegister(active, tool({ core: true }))).toBe(true);
    expect(shouldRegister(active, tool({ toolset: "send.lists" }))).toBe(true);
    expect(shouldRegister(active, tool({ toolset: "send.routes" }))).toBe(false);
  });

  test("does not register against an empty active set", () => {
    expect(shouldRegister(new Set(), tool())).toBe(false);
  });
});
