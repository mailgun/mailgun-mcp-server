// Asserts the published npm tarball ships the optional Agent Skill tree.
// Uses `npm pack --dry-run --json`, so nothing is written or published.

import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

const EXPECTED_SKILL_FILES = [
  "skills/mailgun-inspect-preflight/SKILL.md",
  "skills/mailgun-inspect-preflight/agents/openai.yaml",
  "skills/mailgun-inspect-preflight/references/checks.md",
  "skills/mailgun-inspect-preflight/references/profiles.md",
];

describe("npm package contents", () => {
  test("the tarball includes the mailgun-inspect-preflight skill", { timeout: 60_000 }, () => {
    const stdout = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const [report] = JSON.parse(stdout) as [{ files: { path: string }[] }];
    const paths = new Set(report.files.map((f) => f.path));
    const missing = EXPECTED_SKILL_FILES.filter((p) => !paths.has(p));
    expect(missing).toEqual([]);
  });
});
