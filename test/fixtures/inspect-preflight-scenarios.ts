// Mocked transcript scenarios for the mailgun-inspect-preflight Agent Skill.
// Each scenario is a client-neutral smoke script: paste `setup` (when present)
// and `prompt` into Codex, Claude Code, or Cursor with the skill installed and
// the Mailgun MCP `inspect` tools mocked or pointed at a dedicated test key,
// then compare the agent's tool calls against `expected`.
// The automated test (inspect-preflight-scenarios.test.ts) validates the
// scenarios' internal consistency against the registered tool set; it does not
// run an agent.

export interface SkillScenarioExpectation {
  /** Exact number of run_email_preview_qa calls the transcript may contain. */
  createCalls: 0 | 1;
  /** Tools, in order, the agent is expected to call. Empty means no tool calls. */
  tools: readonly string[];
  /** When a create happens, the exact content_checks it must pass explicitly. */
  contentChecks?: readonly string[];
  /** When a create happens, whether the clients parameter must be omitted. */
  clientsOmitted?: boolean;
  /** Tools that must not appear anywhere in the transcript. */
  forbiddenTools?: readonly string[];
  /** Safety and quality behavior the human runner verifies by reading the transcript. */
  notes: string;
}

export interface SkillScenario {
  id: string;
  title: string;
  /** Context to establish before the prompt (pasted results, mocked tool outcomes). */
  setup?: string;
  /** The user prompt to give the agent. */
  prompt: string;
  expected: SkillScenarioExpectation;
}

const ALL_CHECKS = [
  "link_validation",
  "image_validation",
  "accessibility",
  "code_analysis",
] as const;

const SAMPLE_HTML =
  "<html><body><h1>July launch</h1><a href='https://example.com'>Shop</a></body></html>";

export const SKILL_SCENARIOS: readonly SkillScenario[] = [
  {
    id: "unqualified-preflight",
    title: "Unqualified preflight runs the full profile exactly once, without re-confirming",
    prompt: `Preflight this email before we send it. Subject: "July launch". HTML: ${SAMPLE_HTML}`,
    expected: {
      createCalls: 1,
      tools: ["run_email_preview_qa"],
      contentChecks: ALL_CHECKS,
      clientsOmitted: true,
      forbiddenTools: ["list_preview_tests", "get_preview_result"],
      notes:
        "Exactly one create with all four content_checks passed explicitly, clients and timeout_seconds omitted, and a unique readable reference_id supplied. The prompt already authorizes the run, so the agent must not ask for another confirmation. The report states the profile (full), both requested and not-requested check groups, and says 'Mailgun default client set' without enumerating clients.",
    },
  },
  {
    id: "explain-pasted-result",
    title:
      "A pasted result is interpreted directly; detail is fetched only for the asked-about findings",
    setup:
      "Paste a completed run_email_preview_qa JSON result whose accessibility check is complete with failures > 0 and a result_id, and whose other checks are complete and clean.",
    prompt: "Explain the accessibility findings.",
    expected: {
      createCalls: 0,
      tools: ["get_accessibility_result"],
      forbiddenTools: [
        "run_email_preview_qa",
        "get_email_preview_qa",
        "get_link_validation_result",
        "get_image_validation_result",
        "get_code_analysis_result",
      ],
      notes:
        "The pasted result is interpreted without refreshing it. Only the accessibility detail tool is called, since only that check has findings the user asked about. Failures stay separate from needs_review, and rule counts are distinguished from instance counts.",
    },
  },
  {
    id: "client-planning-no-create",
    title: "Audience planning discusses clients without creating a test or resolving a catalog",
    prompt: "Which email clients should we test for our B2B newsletter audience?",
    expected: {
      createCalls: 0,
      tools: [],
      forbiddenTools: ["run_email_preview_qa", "list_preview_clients"],
      notes:
        "A vague audience gets a stated assumption and a proposed narrower set, but Mailgun defaults are kept unless the user accepts the narrower selection. No test is created and the client catalog is not fetched for a vague audience.",
    },
  },
  {
    id: "resume-by-test-id",
    title: "Resume retrieves an existing test read-only",
    prompt: "Resume preview test abc123.",
    expected: {
      createCalls: 0,
      tools: ["get_email_preview_qa"],
      forbiddenTools: ["run_email_preview_qa"],
      notes:
        "One get_email_preview_qa call with test_id abc123 and timeout_seconds omitted. The report marks the run as resumed, not created.",
    },
  },
  {
    id: "timeout-single-auto-resume",
    title: "A timed-out create gets exactly one automatic resume and never a second create",
    setup:
      "Mock run_email_preview_qa to return a summary with timed_out: true, then mock get_email_preview_qa to return a still-processing summary for the same test_id.",
    prompt: `Preflight this email. Subject: "July launch". HTML: ${SAMPLE_HTML}`,
    expected: {
      createCalls: 1,
      tools: ["run_email_preview_qa", "get_email_preview_qa"],
      contentChecks: ALL_CHECKS,
      clientsOmitted: true,
      notes:
        "After timed_out: true the agent resumes exactly once with the returned test_id and the default timeout. When the resume is still incomplete it stops, reports the evidence, and says a later read-only resume remains safe. No second create.",
    },
  },
  {
    id: "ambiguous-create-stops",
    title: "An uncertain create outcome is reported and never retried",
    setup: "Mock run_email_preview_qa to return the AMBIGUOUS_CREATE error (no test_id).",
    prompt: `Preflight this email. Subject: "July launch". HTML: ${SAMPLE_HTML}`,
    expected: {
      createCalls: 1,
      tools: ["run_email_preview_qa"],
      contentChecks: ALL_CHECKS,
      clientsOmitted: true,
      forbiddenTools: ["list_preview_tests"],
      notes:
        "The agent reports that a test may have been created and stops. It may offer list_preview_tests as a manual troubleshooting step but must not call it automatically, must not recreate, and must not present reference_id as reconciliation or an idempotency key.",
    },
  },
  {
    id: "missing-subject-asks",
    title: "A preflight without a subject asks instead of inferring one",
    prompt: `Preflight this HTML: ${SAMPLE_HTML}`,
    expected: {
      createCalls: 0,
      tools: [],
      forbiddenTools: ["run_email_preview_qa"],
      notes:
        "The agent asks for the subject rather than inferring it from <title>, a heading, or body content. No tool is called until the subject arrives.",
    },
  },
  {
    id: "named-clients-resolved",
    title: "Explicitly named platforms are resolved through the client catalog before the create",
    prompt: `Preflight this email in Outlook on Windows and Apple Mail. Subject: "July launch". HTML: ${SAMPLE_HTML}`,
    expected: {
      createCalls: 1,
      tools: ["list_preview_clients", "run_email_preview_qa"],
      contentChecks: ALL_CHECKS,
      clientsOmitted: false,
      notes:
        "list_preview_clients resolves the named platforms to valid client ids, which are passed exactly as returned. The report lists only the requested clients. Any upstream invalid-client warnings are surfaced without silent correction or an automatic rerun.",
    },
  },
  {
    id: "single-client-drilldown",
    title: "A single-client question drills into exactly that client",
    setup:
      "Paste a completed run_email_preview_qa JSON result whose clients.completed includes outlook_win.",
    prompt: "What happened in Outlook for this test?",
    expected: {
      createCalls: 0,
      tools: ["get_preview_client_result"],
      forbiddenTools: ["run_email_preview_qa", "get_email_preview_qa"],
      notes:
        "Exactly one get_preview_client_result call for the Outlook client; no fan-out across other clients. The summary may include status, metadata, errors, and opaque API-provided screenshot asset keys or links, but it never infers display orientation and performs no visual interpretation of screenshots.",
    },
  },
  {
    id: "remediation-no-edit-no-rerun",
    title: "Remediation proposes fixes without editing files or rerunning",
    setup:
      "Paste a completed run_email_preview_qa JSON result with link_validation failures > 0 and a result_id; other checks clean.",
    prompt: "Help me fix these Email Preview QA findings.",
    expected: {
      createCalls: 0,
      tools: ["get_link_validation_result"],
      forbiddenTools: [
        "run_email_preview_qa",
        "get_image_validation_result",
        "get_accessibility_result",
        "get_code_analysis_result",
      ],
      notes:
        "Detail is fetched only for the failing check. The agent proposes concrete HTML changes but edits no files and states that a post-fix verification test needs a fresh explicit request.",
    },
  },
] as const;
