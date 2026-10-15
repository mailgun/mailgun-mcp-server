import { describe, test, expect } from "vitest";
import {
  formatHelp,
  formatInvalidTagsMessage,
  formatTagList,
  resolveActiveTags,
} from "../src/cli.js";
import { KNOWN_TAG_SELECTORS, KNOWN_TAGS, TOOLSET_IDS } from "../src/tags.js";

describe("resolveActiveTags()", () => {
  test('returns "default" when neither flag nor env is set', () => {
    const result = resolveActiveTags([], {});
    expect(result.activeTags).toBe("default");
    expect(result.showHelp).toBe(false);
    expect(result.listTags).toBe(false);
    expect(result.invalid).toEqual([]);
  });

  test("parses MAILGUN_MCP_TAGS env var when no CLI flag", () => {
    const result = resolveActiveTags([], { MAILGUN_MCP_TAGS: "send,validate" });
    expect(result.activeTags).toEqual(new Set(["send", "validate"]));
  });

  test("parses --tags CLI flag", () => {
    const result = resolveActiveTags(["--tags", "validate,inspect"], {});
    expect(result.activeTags).toEqual(new Set(["validate", "inspect"]));
  });

  test("supports --tags=value syntax", () => {
    const result = resolveActiveTags(["--tags=validate,inspect"], {});
    expect(result.activeTags).toEqual(new Set(["validate", "inspect"]));
  });

  test("CLI overrides env when both are set", () => {
    const result = resolveActiveTags(["--tags", "inspect"], {
      MAILGUN_MCP_TAGS: "send,validate",
    });
    expect(result.activeTags).toEqual(new Set(["inspect"]));
  });

  test("last --tags wins when specified twice", () => {
    const result = resolveActiveTags(["--tags", "send", "--tags", "validate,inspect"], {});
    expect(result.activeTags).toEqual(new Set(["validate", "inspect"]));
  });

  test("--help is reflected in result without exiting", () => {
    const result = resolveActiveTags(["--help"], {});
    expect(result.showHelp).toBe(true);
    expect(result.activeTags).toBe("default");
  });

  test("-h is treated as --help", () => {
    const result = resolveActiveTags(["-h"], {});
    expect(result.showHelp).toBe(true);
  });

  test("--list-tags is reflected in result", () => {
    const result = resolveActiveTags(["--list-tags"], {});
    expect(result.listTags).toBe(true);
    expect(result.activeTags).toBe("default");
  });

  test("unknown tags populate invalid and leave activeTags as default", () => {
    const result = resolveActiveTags(["--tags", "send,foo,bar"], {});
    expect(result.invalid).toEqual(["foo", "bar"]);
    expect(result.activeTags).toBe("default");
  });

  test("empty --tags value is treated as default", () => {
    const result = resolveActiveTags(["--tags", ""], {
      MAILGUN_MCP_TAGS: "validate",
    });
    expect(result.activeTags).toBe("default");
  });

  test('--tags "," is treated as default, not a zero-tool filter', () => {
    const result = resolveActiveTags(["--tags", ","], {});
    expect(result.activeTags).toBe("default");
    expect(result.invalid).toEqual([]);
  });

  test('--tags " , , " is treated as default, not a zero-tool filter', () => {
    const result = resolveActiveTags(["--tags", " , , "], {});
    expect(result.activeTags).toBe("default");
    expect(result.invalid).toEqual([]);
  });

  test("MAILGUN_MCP_TAGS containing only separators is treated as default", () => {
    const result = resolveActiveTags([], { MAILGUN_MCP_TAGS: " , , " });
    expect(result.activeTags).toBe("default");
    expect(result.invalid).toEqual([]);
  });

  test("ignores unrelated argv tokens", () => {
    const result = resolveActiveTags(["--unknown-flag", "value", "--tags", "send"], {});
    expect(result.activeTags).toEqual(new Set(["send"]));
  });

  test('--tags all returns "all"', () => {
    expect(resolveActiveTags(["--tags", "all"], {}).activeTags).toBe("all");
    expect(resolveActiveTags(["--tags=ALL"], {}).activeTags).toBe("all");
  });

  test('MAILGUN_MCP_TAGS=all returns "all"', () => {
    expect(resolveActiveTags([], { MAILGUN_MCP_TAGS: "all" }).activeTags).toBe("all");
  });

  test("all wins when combined with other values", () => {
    expect(resolveActiveTags(["--tags", "validate,all"], {}).activeTags).toBe("all");
  });

  test("CLI overrides env when either uses all", () => {
    expect(
      resolveActiveTags(["--tags", "inspect"], { MAILGUN_MCP_TAGS: "all" }).activeTags,
    ).toEqual(new Set(["inspect"]));
    expect(resolveActiveTags(["--tags", "all"], { MAILGUN_MCP_TAGS: "inspect" }).activeTags).toBe(
      "all",
    );
  });

  test("accepts toolset IDs and core", () => {
    const result = resolveActiveTags(["--tags", "core,send.templates"], {});
    expect(result.activeTags).toEqual(new Set(["core", "send.templates"]));
    expect(result.invalid).toEqual([]);
  });
});

describe("formatHelp()", () => {
  test("includes every known tag in the help output", () => {
    const help = formatHelp();
    for (const tag of KNOWN_TAGS) {
      expect(help).toContain(tag);
    }
    expect(help).toMatch(/--tags/);
    expect(help).toMatch(/--tags all/);
    expect(help).toMatch(/--list-tags/);
    expect(help).toMatch(/--help/);
  });
});

describe("formatTagList()", () => {
  test("lists every valid --tags value, one per line, with a description", () => {
    const lines = formatTagList().split("\n");
    const names = lines.map((line) => line.split(/\s+/)[0]);
    expect(names.toSorted()).toEqual([...KNOWN_TAG_SELECTORS].toSorted());
    for (const line of lines) {
      expect(line).toMatch(/^\S+\s{2,}\S/);
    }
  });

  test("starts with all and core, then tags, then toolsets", () => {
    const names = formatTagList()
      .split("\n")
      .map((line) => line.split(/\s+/)[0]);
    expect(names.slice(0, 3)).toEqual(["all", "core", "send"]);
    expect(names.slice(3)).toEqual([...TOOLSET_IDS]);
  });
});

describe("formatInvalidTagsMessage()", () => {
  test("lists offenders and every valid value", () => {
    const msg = formatInvalidTagsMessage(["foo", "bar"]);
    expect(msg).toContain("foo");
    expect(msg).toContain("bar");
    for (const selector of KNOWN_TAG_SELECTORS) {
      expect(msg).toContain(selector);
    }
  });

  test("uses singular form for a single invalid tag", () => {
    const msg = formatInvalidTagsMessage(["foo"]);
    expect(msg).toMatch(/Unknown tag:/);
  });

  test("uses plural form for multiple invalid tags", () => {
    const msg = formatInvalidTagsMessage(["foo", "bar"]);
    expect(msg).toMatch(/Unknown tags:/);
  });
});
