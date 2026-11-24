// Validates the standard Agent Skill structure and frontmatter of
// skills/mailgun-inspect-preflight. The MVP tree is fixed: SKILL.md, optional
// Codex metadata, and two references; no scripts, assets, or skill-local README.

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const SKILL_NAME = "mailgun-inspect-preflight";
const SKILL_DIR = new URL(`../../skills/${SKILL_NAME}/`, import.meta.url).pathname;

const EXPECTED_FILES = [
  "SKILL.md",
  "agents/openai.yaml",
  "references/checks.md",
  "references/profiles.md",
];

function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFiles(join(dir, entry.name), rel));
    else files.push(rel);
  }
  return files;
}

interface Frontmatter {
  name?: unknown;
  description?: unknown;
}

function parseSkillMd(): { frontmatter: Frontmatter; body: string } {
  const raw = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match === null) throw new Error("SKILL.md must start with a YAML frontmatter block");
  return { frontmatter: load(match[1]) as Frontmatter, body: match[2] };
}

describe("mailgun-inspect-preflight skill structure", () => {
  test("contains exactly the MVP file tree", () => {
    expect(listFiles(SKILL_DIR).sort()).toEqual([...EXPECTED_FILES].sort());
  });

  test("SKILL.md frontmatter has a matching name and a usable description", () => {
    const { frontmatter } = parseSkillMd();
    expect(frontmatter.name).toBe(SKILL_NAME);
    expect(typeof frontmatter.description).toBe("string");
    const description = frontmatter.description as string;
    expect(description.trim().length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    // The description is the trigger surface; it must state the negative boundary too.
    expect(description).toMatch(/Do not use/i);
  });

  test("SKILL.md body embeds the safety-critical sections", () => {
    const { body } = parseSkillMd();
    for (const heading of [
      "## Trigger boundary",
      "## Tools",
      "## Intent routing",
      "## Create/resume state machine",
      "## Input rules",
      "## Checks and clients",
      "## Evidence retrieval",
      "## Reporting",
    ]) {
      expect(body).toContain(heading);
    }
    // Both references must be loaded conditionally from the body.
    expect(body).toContain("references/profiles.md");
    expect(body).toContain("references/checks.md");
  });

  test("agents/openai.yaml parses and stays presentation-only metadata", () => {
    const raw = readFileSync(join(SKILL_DIR, "agents/openai.yaml"), "utf8");
    const parsed = load(raw) as { interface?: { display_name?: unknown } };
    expect(typeof parsed.interface?.display_name).toBe("string");
    // No dependency or policy blocks: the file must not be required for correctness.
    expect(Object.keys(parsed)).toEqual(["interface"]);
  });

  test("references are non-empty Markdown documents", () => {
    for (const ref of ["references/checks.md", "references/profiles.md"]) {
      const raw = readFileSync(join(SKILL_DIR, ref), "utf8");
      expect(raw).toMatch(/^# /);
      expect(raw.trim().length).toBeGreaterThan(200);
    }
  });
});
