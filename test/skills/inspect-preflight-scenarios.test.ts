// Consistency checks for the mocked transcript scenarios that gate the
// mailgun-inspect-preflight skill. The scenarios themselves are executed
// manually in Codex, Claude Code, and Cursor; this test keeps them honest
// against the registered tool set and the skill's safety rules, with no live
// API calls.

import { describe, test, expect } from "vitest";
import { CHECK_NAMES } from "../../src/custom-tools/email-preview-qa.js";
import { SKILL_SCENARIOS } from "../fixtures/inspect-preflight-scenarios.js";
import { collectRegisteredToolNames } from "./registered-tools.js";

const REQUIRED_SCENARIO_IDS = [
  "unqualified-preflight",
  "explain-pasted-result",
  "client-planning-no-create",
  "resume-by-test-id",
  "timeout-single-auto-resume",
  "ambiguous-create-stops",
  "missing-subject-asks",
  "named-clients-resolved",
  "single-client-drilldown",
  "remediation-no-edit-no-rerun",
];

describe("mailgun-inspect-preflight mocked scenarios", () => {
  const registered = collectRegisteredToolNames();

  test("scenario ids are unique and cover the acceptance behaviors", () => {
    const ids = SKILL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const missing = REQUIRED_SCENARIO_IDS.filter((id) => !ids.includes(id));
    expect(missing).toEqual([]);
  });

  test.each(SKILL_SCENARIOS)("$id references only registered tools", (scenario) => {
    const referenced = [...scenario.expected.tools, ...(scenario.expected.forbiddenTools ?? [])];
    const unregistered = referenced.filter((tool) => !registered.has(tool));
    expect(unregistered).toEqual([]);
  });

  test.each(SKILL_SCENARIOS)("$id keeps create accounting consistent", (scenario) => {
    const { expected } = scenario;
    const createsInTools = expected.tools.filter((t) => t === "run_email_preview_qa").length;
    expect(createsInTools).toBe(expected.createCalls);
    // At most one create anywhere; recreation is never an expected behavior.
    expect(expected.createCalls).toBeLessThanOrEqual(1);
    // Create parameters only make sense when a create happens.
    const declaresCreateParams =
      expected.contentChecks !== undefined || expected.clientsOmitted !== undefined;
    expect(declaresCreateParams && expected.createCalls === 0).toBe(false);
  });

  test.each(SKILL_SCENARIOS)("$id uses valid content check names", (scenario) => {
    const checks = scenario.expected.contentChecks ?? [];
    const invalid = checks.filter((c) => !(CHECK_NAMES as readonly string[]).includes(c));
    expect(invalid).toEqual([]);
  });

  test.each(SKILL_SCENARIOS)("$id never both expects and forbids a tool", (scenario) => {
    const forbidden = new Set(scenario.expected.forbiddenTools ?? []);
    const overlap = scenario.expected.tools.filter((tool) => forbidden.has(tool));
    expect(overlap).toEqual([]);
  });

  test("no-create scenarios exist for explain, plan, resume, and missing-subject intents", () => {
    for (const id of [
      "explain-pasted-result",
      "client-planning-no-create",
      "resume-by-test-id",
      "missing-subject-asks",
    ]) {
      const scenario = SKILL_SCENARIOS.find((s) => s.id === id);
      expect(scenario?.expected.createCalls).toBe(0);
    }
  });

  test("every create scenario passes all selected checks explicitly", () => {
    const missingChecks = SKILL_SCENARIOS.filter(
      (s) => s.expected.createCalls === 1 && s.expected.contentChecks === undefined,
    ).map((s) => s.id);
    expect(missingChecks).toEqual([]);
  });
});
