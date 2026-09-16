import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PACKAGE_NAME, PACKAGE_VERSION, USER_AGENT } from "../src/version.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  name: string;
  version: string;
};

describe("USER_AGENT", () => {
  test("uses the package name and version in @scope/name/version form", () => {
    expect(PACKAGE_NAME).toBe(packageJson.name);
    expect(PACKAGE_VERSION).toBe(packageJson.version);
    expect(USER_AGENT).toBe(`${packageJson.name}/${packageJson.version}`);
  });

  test("matches the Mailgun client user-agent format", () => {
    expect(USER_AGENT).toMatch(/^@mailgun\/mcp-server\/\d+\.\d+\.\d+$/);
  });
});
