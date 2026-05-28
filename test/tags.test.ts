import { describe, test, expect } from "vitest";
import { KNOWN_TAGS, parseTagList, shouldRegister } from "../src/tags.js";

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

describe("shouldRegister()", () => {
  test('"all" always registers, even with empty entry tags', () => {
    expect(shouldRegister("all", [])).toBe(true);
    expect(shouldRegister("all", ["send"])).toBe(true);
    expect(shouldRegister("all", ["send", "validate"])).toBe(true);
  });

  test("registers when entry tags intersect active set", () => {
    const active = new Set(["send", "validate"] as const);
    expect(shouldRegister(active, ["send"])).toBe(true);
    expect(shouldRegister(active, ["validate"])).toBe(true);
    expect(shouldRegister(active, ["validate", "inspect"])).toBe(true);
  });

  test("does not register when entry tags are disjoint", () => {
    const active = new Set(["send"] as const);
    expect(shouldRegister(active, ["validate"])).toBe(false);
    expect(shouldRegister(active, ["inspect", "optimize"])).toBe(false);
  });

  test("does not register when entry has no tags and active is filtered", () => {
    const active = new Set(["send"] as const);
    expect(shouldRegister(active, [])).toBe(false);
  });

  test("does not register against an empty active set", () => {
    expect(shouldRegister(new Set(), ["send"])).toBe(false);
  });
});
