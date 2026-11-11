import { describe, expect, test } from "vitest";
import { hostedConfig, localConfig, resolveApiHostname } from "../src/config.js";

describe("resolveApiHostname()", () => {
  test.each([
    ["no region", {}, "api.mailgun.net"],
    ["an empty region", { MAILGUN_API_REGION: "" }, "api.mailgun.net"],
    ["eu", { MAILGUN_API_REGION: "eu" }, "api.eu.mailgun.net"],
    ["EU", { MAILGUN_API_REGION: "EU" }, "api.eu.mailgun.net"],
    ["an unknown region", { MAILGUN_API_REGION: "asia" }, "api.mailgun.net"],
  ])("maps %s to its hostname", (_label, env, hostname) => {
    expect(resolveApiHostname(env)).toBe(hostname);
  });

  test("MAILGUN_API_HOSTNAME wins over the region", () => {
    expect(
      resolveApiHostname({ MAILGUN_API_REGION: "eu", MAILGUN_API_HOSTNAME: "mailgun.internal" }),
    ).toBe("mailgun.internal");
  });
});

describe("localConfig()", () => {
  test("uses the key and hostname from the environment", () => {
    expect(localConfig({ MAILGUN_API_KEY: "key-local", MAILGUN_API_REGION: "eu" })).toEqual({
      apiKey: "key-local",
      hostname: "api.eu.mailgun.net",
    });
  });

  test.each([
    ["missing", {}],
    ["empty", { MAILGUN_API_KEY: "" }],
  ])("returns undefined when the key is %s", (_label, env) => {
    expect(localConfig(env)).toBeUndefined();
  });
});

describe("hostedConfig()", () => {
  test("puts the caller's key on the deployment's hostname", () => {
    expect(hostedConfig("key-caller", "api.eu.mailgun.net")).toEqual({
      apiKey: "key-caller",
      hostname: "api.eu.mailgun.net",
    });
  });

  test("rejects an empty key", () => {
    expect(() => hostedConfig("", "api.mailgun.net")).toThrow("A Mailgun API key is required.");
  });
});
