import { describe, test, expect } from "vitest";
import { MailgunApiError } from "../src/api.js";

describe("MailgunApiError", () => {
  test("carries statusCode and apiMessage", () => {
    const err = new MailgunApiError("forbidden", 403, "Plan upgrade required");
    expect(err.statusCode).toBe(403);
    expect(err.apiMessage).toBe("Plan upgrade required");
    expect(err.message).toBe("forbidden");
    expect(err.name).toBe("MailgunApiError");
    expect(err).toBeInstanceOf(Error);
  });

  test("works without apiMessage", () => {
    const err = new MailgunApiError("parse error", 500);
    expect(err.statusCode).toBe(500);
    expect(err.apiMessage).toBeUndefined();
  });
});
