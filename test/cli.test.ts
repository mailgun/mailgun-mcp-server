import { describe, test, expect } from "vitest";
import {
  formatHelp,
  formatInvalidTagsMessage,
  formatTagList,
  resolveActiveTags,
} from "../src/cli.js";
import { KNOWN_TAGS } from "../src/tags.js";

describe("resolveActiveTags()", () => {
  test('returns "all" when neither flag nor env is set', () => {
    const result = resolveActiveTags([], {});
    expect(result.activeTags).toBe("all");
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
    expect(result.activeTags).toBe("all");
  });

  test("-h is treated as --help", () => {
    const result = resolveActiveTags(["-h"], {});
    expect(result.showHelp).toBe(true);
  });

  test("--list-tags is reflected in result", () => {
    const result = resolveActiveTags(["--list-tags"], {});
    expect(result.listTags).toBe(true);
    expect(result.activeTags).toBe("all");
  });

  test("unknown tags populate invalid and leave activeTags as default", () => {
    const result = resolveActiveTags(["--tags", "send,foo,bar"], {});
    expect(result.invalid).toEqual(["foo", "bar"]);
    expect(result.activeTags).toBe("all");
  });

  test("empty --tags value is treated as default (all)", () => {
    const result = resolveActiveTags(["--tags", ""], {
      MAILGUN_MCP_TAGS: "validate",
    });
    expect(result.activeTags).toBe("all");
  });

  test('--tags "," is treated as default (all), not a zero-tool filter', () => {
    const result = resolveActiveTags(["--tags", ","], {});
    expect(result.activeTags).toBe("all");
    expect(result.invalid).toEqual([]);
  });

  test('--tags " , , " is treated as default (all), not a zero-tool filter', () => {
    const result = resolveActiveTags(["--tags", " , , "], {});
    expect(result.activeTags).toBe("all");
    expect(result.invalid).toEqual([]);
  });

  test("MAILGUN_MCP_TAGS containing only separators is treated as default (all)", () => {
    const result = resolveActiveTags([], { MAILGUN_MCP_TAGS: " , , " });
    expect(result.activeTags).toBe("all");
    expect(result.invalid).toEqual([]);
  });

  test("ignores unrelated argv tokens", () => {
    const result = resolveActiveTags(["--unknown-flag", "value", "--tags", "send"], {});
    expect(result.activeTags).toEqual(new Set(["send"]));
  });
});

describe("formatHelp()", () => {
  test("includes every known tag in the help output", () => {
    const help = formatHelp();
    for (const tag of KNOWN_TAGS) {
      expect(help).toContain(tag);
    }
    expect(help).toMatch(/--tags/);
    expect(help).toMatch(/--list-tags/);
    expect(help).toMatch(/--help/);
  });
});

describe("formatTagList()", () => {
  test("lists every known tag, one per line", () => {
    const lines = formatTagList().split("\n");
    expect(lines).toEqual([...KNOWN_TAGS]);
  });
});

describe("formatInvalidTagsMessage()", () => {
  test("lists offenders and the valid tag set", () => {
    const msg = formatInvalidTagsMessage(["foo", "bar"]);
    expect(msg).toContain("foo");
    expect(msg).toContain("bar");
    for (const tag of KNOWN_TAGS) {
      expect(msg).toContain(tag);
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
