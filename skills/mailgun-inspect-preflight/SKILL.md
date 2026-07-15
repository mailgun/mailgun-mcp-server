---
name: mailgun-inspect-preflight
description: Preflight rendered email HTML with Mailgun Inspect Email Preview QA through the Mailgun MCP server. Use for operational email QA requests such as "preflight this email", "run all Inspect checks on this HTML", "resume preview test <id>", explaining link, image, accessibility, or code-analysis findings, choosing preview clients for an audience, drilling into one client's render, or handing confirmed findings to a host coding agent for explicitly requested workspace remediation. Do not use for sending email, Mailgun analytics, generic Mailgun API questions, developing the MCP server itself, or unrelated source editing.
---

# Mailgun Inspect Email Preflight

Route natural-language email QA requests to the Mailgun MCP server's Inspect tools. The MCP owns validation, polling, normalization, and create safety; this skill only chooses the right tool, prepares inputs, and reports results. Never bypass the MCP with raw HTTP, shell requests, a low-level preview-create endpoint, or a Mailgun CLI.

## Trigger boundary

Handle these operational Email Preview QA intents:

1. Run a preflight against rendered email HTML.
2. Resume or refresh an existing test from a `test_id`.
3. Explain summarized results and data gaps.
4. Select checks and clients from the request or intended audience.
5. Suggest concrete remediation for reported findings, or hand an explicitly requested workspace edit to the host coding agent.
6. Drill into and, when explicitly requested, visually review one specific client render.

Do not trigger for MCP server development, generic Mailgun API questions, sending email, analytics or metrics, or unrelated source editing.

## Tools

Always required (both from the Mailgun MCP server with the `inspect` tag enabled):

- `run_email_preview_qa`: one explicitly authorized new preflight. Creates a remote test and consumes preview quota; it does not send email.
- `get_email_preview_qa`: an existing test, a refresh, or the one allowed automatic resume.

Conditional, called only for the stated reason:

- `list_preview_clients`: resolve explicitly named platforms, or a user-approved audience-specific client set.
- `get_preview_client_result`: an explicit single-client render or visual-diagnostic drill-down.
- `get_link_validation_result`: explain or remediate link findings.
- `get_image_validation_result`: explain or remediate image findings.
- `get_accessibility_result`: explain or remediate accessibility findings.
- `get_code_analysis_result`: explain or remediate code-analysis findings.
- `list_preview_tests`: optional manual troubleshooting after an uncertain create; never automatic reconciliation.

If a required tool is unavailable, stop and give setup guidance: the Mailgun MCP server (`@mailgun/mcp-server`) must be configured with `MAILGUN_API_KEY` and must not exclude the `inspect` tag. Do not substitute raw API, shell, or CLI calls.

## Intent routing

| Request                               | Action                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Run, test, or preflight this email    | Prepare inputs, then `run_email_preview_qa` once                                                                                                |
| Resume, refresh, or check test `<id>` | `get_email_preview_qa` with that `test_id`                                                                                                      |
| Explain results or data gaps          | Interpret the composite result; fetch check detail only per the evidence rules                                                                  |
| Which clients should we test?         | Discuss; use `list_preview_clients` only for named platforms or an approved narrower set; no create                                             |
| What happened in client X?            | `get_preview_client_result` for that one client                                                                                                 |
| Visually inspect client X             | Retrieve that one client result; hand the selected screenshot to the host's image viewer; label observations separately                         |
| Fix these findings                    | Fetch relevant detail; an explicitly authorized workspace edit may be handed to the host coding agent; verification needs fresh explicit intent |
| Pasted structured result              | Interpret directly; call `get_email_preview_qa` only for a requested refresh or a `test_id` needing retrieval                                   |

## Create/resume state machine (safety-critical, overrides conversational convenience)

1. "Run", "test", "preflight", or equivalent explicit operational intent authorizes exactly one quota-consuming call to `run_email_preview_qa` for the supplied content.
2. Explaining, planning, selecting clients, resuming, or inspecting pasted results does not authorize a create.
3. A later verification run requires fresh explicit intent. Do not add a redundant confirmation after the user has already authorized the run.
4. If create returns an accepted result with a `test_id`, treat creation as complete and follow the returned polling/result state.
5. If the result times out (`timed_out: true`), or polling fails after creation and a `test_id` is available (error code `POLL_FAILED_AFTER_CREATE`), automatically call `get_email_preview_qa` exactly once with that `test_id`.
6. If that one resume is still incomplete or fails, stop and report the current evidence and whether a later read-only resume remains safe.
7. If the create transport fails before a definitive response and no `test_id` is available (error codes `AMBIGUOUS_CREATE`, `CREATE_NO_TEST_ID`), report that the outcome is uncertain and stop. Never automatically recreate.
8. `list_preview_tests` may be offered as manual troubleshooting after an uncertain create, but never claim it can reconcile by `reference_id` and never call it automatically.
9. Interpret a pasted structured result directly. Call `get_email_preview_qa` only when the user requests a refresh or supplies a `test_id` that needs retrieval.

## Input rules

**HTML.** Accept inline rendered HTML, a rendered `.html` file, or the output of an existing, clearly documented repository render command (MJML, React Email, or another template system). If no documented render path exists, ask for rendered HTML. Do not invent a build command and do not submit unrendered template source. HTML is the only supported source (no URL, MIME, ZIP, or template inputs) and is capped at 10 MiB UTF-8.

**Subject.** Use a subject the user supplied explicitly or that is clearly available in the request or campaign configuration. Do not infer it from `<title>`, a heading, or body content. Ask when absent.

**Reference ID.** Always supply a readable, unique `reference_id`: preserve a user-supplied identifier, otherwise combine a campaign or template slug with a UTC timestamp (for example `summer-launch-20260712T183000Z`). It is only a correlation aid: not an idempotency key, not a guaranteed lookup field, and not proof that a create succeeded.

**Timeout.** Omit `timeout_seconds` and use the MCP default unless the user requests a value. The one automatic resume also uses the MCP default unless the user supplied a preference.

## Checks and clients

An unqualified preflight uses the `full` profile and explicitly passes all four checks as `content_checks`: `link_validation`, `image_validation`, `accessibility`, `code_analysis`. Every named profile explicitly passes its checks; never rely on MCP defaults for check selection. Load `references/profiles.md` when choosing a profile, checks, or a client strategy.

Omit `clients` to use Mailgun's default client set. For explicitly named platforms, resolve valid client ids with `list_preview_clients`. For a vague audience description, state your assumption and propose a narrower set, but keep Mailgun defaults unless the user accepts the narrower selection.

Surface upstream invalid-client warnings from the result's `warnings`. Do not silently correct the selection or rerun. You may offer a corrected selection for a future test, which requires fresh explicit create intent.

State the selected profile, checks, and client strategy before or with the result.

## Evidence retrieval

Normal preflight reporting uses the composite result only. Fetch a per-check detail payload only when both hold:

- the user asks for explanation or remediation, and
- that check has findings or an evidence gap that needs clarification.

Do not fetch details for clean or unrequested checks. Use `get_preview_client_result` only for a client the user explicitly asks about or for explicit render diagnostics; never fan out across all clients. By default, client drill-down summarizes status, metadata, errors, and available screenshot asset keys without visual interpretation.

When the user explicitly asks for a visual review, retrieve exactly one requested client result and hand one available screenshot to the host's normal image-viewing capability. Treat keys in `screenshots` as opaque API-provided asset names: prefer `default` when present, otherwise use another entry from `screenshots`, and fall back to `full_thumbnail` or `thumbnail`. Do not infer display orientation from an asset key or client metadata. Do not reproduce the signed screenshot URL in the report or persist the image beyond the task unless requested. Put the conclusions under a **Model visual observations** label and keep them separate from **Inspect-reported findings**. A screenshot may support observations about clipping, overlap, missing visual content, and qualitative legibility; it cannot verify alt text, semantic roles, screen-reader behavior, or exact WCAG contrast ratios.

Remediation normally proposes concrete changes. When the user explicitly asks to fix a rendered HTML file in the current workspace, the skill may hand that edit to the host coding agent under the host's normal file-editing authorization and review policy. This skill does not itself grant write permission, must not change remote templates, and must not invent a source-build mapping for generated HTML. Show a compact diff or change summary. A post-fix verification test requires new explicit create intent.

Load `references/checks.md` when explaining check results, lifecycle states, counts, warnings, or `data_gaps`.

## Reporting

Do not invent pass/fail. Without user-supplied policy, describe results qualitatively and keep confirmed findings separate from missing or incomplete evidence. Missing evidence is a data gap, never a successful check or a fabricated zero.

Return a compact response in the conversation by default; write a Markdown report only when explicitly requested. Include, when applicable:

1. **Outcome**: completed, partial, timed out, or blocked by an upstream error.
2. **Run identity**: `test_id` and `reference_id` when available, and whether the test was created or resumed.
3. **Coverage**: requested and not-requested checks; there are only four, so list both groups explicitly.
4. **Priority findings**: broken links, image failures, accessibility issues, code concerns.
5. **Client renders**: lifecycle summary and relevant requested clients.
6. **Data gaps and warnings**: incomplete evidence, unavailable details, upstream warnings.
7. **Next action**: whether a read-only resume remains safe, or a fresh explicit create would be required.

When both evidence channels are present, report **Inspect-reported findings** before **Model visual observations** so a visually clean render never masks structured accessibility findings.

For clients: when defaults were used, say "Mailgun default client set" without enumerating included or excluded clients; when clients were explicit, list only the requested clients (or summarize the count if long); never emit the catalog of unselected clients.

Minimize sensitive content: summarize payloads, avoid reproducing raw HTML, full detail payloads, or long URLs unless necessary or requested, and never persist result details automatically.
