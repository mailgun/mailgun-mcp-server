// Drift test: every MCP tool the mailgun-inspect-preflight skill names as
// required or conditional must remain registered by this server. This guards
// the skill's tool contract without introducing a runtime manifest.

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectRegisteredToolNames } from "./registered-tools.js";

const SKILL_DIR = new URL("../../skills/mailgun-inspect-preflight/", import.meta.url).pathname;

// Tool names referenced by the skill follow the server's verb_noun convention.
const TOOL_TOKEN = /`((?:run|get|list)_[a-z0-9_]+)`/g;

function extractToolNames(relPath: string): Set<string> {
  const raw = readFileSync(join(SKILL_DIR, relPath), "utf8");
  return new Set([...raw.matchAll(TOOL_TOKEN)].map((m) => m[1]));
}

const ALWAYS_REQUIRED = ["run_email_preview_qa", "get_email_preview_qa"];

const CONDITIONAL = [
  "list_preview_clients",
  "get_preview_client_result",
  "get_link_validation_result",
  "get_image_validation_result",
  "get_accessibility_result",
  "get_code_analysis_result",
  "list_preview_tests",
];

describe("mailgun-inspect-preflight tool drift", () => {
  const registered = collectRegisteredToolNames();
  const skillDocs = ["SKILL.md", "references/checks.md", "references/profiles.md"];

  test("SKILL.md names the complete tool contract", () => {
    const named = extractToolNames("SKILL.md");
    const missing = [...ALWAYS_REQUIRED, ...CONDITIONAL].filter((tool) => !named.has(tool));
    expect(missing).toEqual([]);
  });

  test.each(skillDocs)("every tool named in %s is registered by the server", (doc) => {
    const named = extractToolNames(doc);
    const unregistered = [...named].filter((tool) => !registered.has(tool));
    expect(unregistered).toEqual([]);
  });

  test("the extraction pattern actually finds tools (guards silent regressions)", () => {
    const named = extractToolNames("SKILL.md");
    expect(named.size).toBeGreaterThanOrEqual(ALWAYS_REQUIRED.length + CONDITIONAL.length);
  });

  test("the composite tools remain registered under their exact names", () => {
    const missing = ALWAYS_REQUIRED.filter((tool) => !registered.has(tool));
    expect(missing).toEqual([]);
  });
});
