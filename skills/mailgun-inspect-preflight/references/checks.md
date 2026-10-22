# Inspect structured checks reference

The composite tools (`run_email_preview_qa`, `get_email_preview_qa`) return one normalized result covering client rendering plus four structured content checks. This reference explains how to read that result and when to reach for a detail tool.

## The four checks

| Check            | Composite key             | Detail tool                   | Detail id                           |
| ---------------- | ------------------------- | ----------------------------- | ----------------------------------- |
| Link validation  | `checks.link_validation`  | `get_link_validation_result`  | `checks.link_validation.result_id`  |
| Image validation | `checks.image_validation` | `get_image_validation_result` | `checks.image_validation.result_id` |
| Accessibility    | `checks.accessibility`    | `get_accessibility_result`    | `checks.accessibility.result_id`    |
| Code analysis    | `checks.code_analysis`    | `get_code_analysis_result`    | `checks.code_analysis.result_id`    |

Call a detail tool only under the evidence rules in `SKILL.md`, and only with the `result_id` from the composite result. A `result_id` of `null` means detailed results cannot be retrieved for that check.

## Check lifecycle states

Each check reports a `status`:

- `not_requested`: the check was not selected at create time. Report it as not requested, never as passing.
- `processing`: the check job or its detail result is still settling (upstream status `Processing`, or no status snapshot was read before the deadline). Resuming with the same `test_id` may complete it.
- `complete`: the detail result was retrieved with a completed status and its counts are trustworthy.
- `job_failed`: the upstream check job failed (`Failed`/`Error` status, or errors at create time). There are no counts to trust. A `check_job_failed` entry appears in `data_gaps`.
- `unavailable`: the check was requested but Inspect did not run it, exposed no result reference, returned an unrecognized status, or its detail endpoint was unavailable. A matching entry appears in `data_gaps`. On a resume, a check that was never requested can also surface here, because Inspect omits unrequested checks and the resume has no record of the original selection.

Counts for any state other than `complete` are zero-filled placeholders, not findings. Never present them as "0 issues found".

## Client rendering vs structured checks

Client-render completion and structured-check completion are independent:

- The top-level `status` describes client rendering only: `complete`, `processing`, `partial` (some clients bounced), or `unknown` (no render state yet).
- `summary` and `clients` bucket client ids into `completed`, `processing`, and `bounced`.
- Slow or stuck client renders never block content checks. A `render_incomplete` data gap with checks `complete` means the findings are final but some screenshots are still processing; a read-only resume with the same `test_id` can collect the remaining renders.
- `timed_out: true` means the workflow deadline passed while something was still settling; resume with the same `test_id` per the state machine.

## Count semantics

**Link and image validation** (`passes`, `failures`, `informational`, `by_severity`): entry-level bucket counts. `by_severity` covers failures only, keyed by the upstream severity spelling; blank severities bucket as `unknown`.

**Accessibility**: headline `failures` and `needs_review` count instances; `failure_rules` and `needs_review_rules` count distinct rules. A rule without listed instances still counts once. Report both when explaining, for example "3 failing rules, 17 instances". `needs_review` items are not confirmed failures; keep them separate.

**Code analysis**: `count` is the upstream feature total, `instances` is the sum of per-feature occurrences, and `by_feature` maps feature slug to occurrence count. `application_support`, `inbox_provider_support`, and `market_support` pass through upstream support breakdowns. Code analysis describes client-support tradeoffs, not defects, so it never contributes to `issue_counts`.

**Aggregate `issue_counts`**: `total`, `by_check`, `by_severity`, and `by_check_and_severity` aggregate failures from link validation, image validation, and accessibility only, and only for checks in the `complete` state.

## Warnings

`warnings` carries upstream create-time warnings as `{ name, message }` pairs, notably invalid or unrecognized client selections. Surface them verbatim in the report. Do not silently correct the client selection or rerun; a corrected selection requires fresh explicit create intent.

## Data gaps

Every `data_gaps` entry has a `code`, `message`, and `impact`. Report gaps in the reader's terms and never convert one into a passing result. Codes:

| Code                              | Meaning                                          | Safe follow-up                             |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| `render_clients_unavailable`      | No client rendering state yet                    | Read-only resume later                     |
| `render_incomplete`               | Some client renders still processing             | Read-only resume collects the rest         |
| `requested_client_missing`        | A requested client appeared in no render state   | Report; may be unsupported or initializing |
| `check_not_run`                   | Inspect skipped link/image validation (nothing to check) | Confirm the HTML has no links/images; not a pass |
| `check_reference_missing`         | A requested check exposed no result reference    | Detail results unretrievable for this test |
| `check_job_failed`                | The upstream check job failed                    | No findings exist; never report "0 issues" |
| `check_status_unrecognized`       | A detail result had an unknown or missing status | Results not counted; report the gap        |
| `result_endpoint_unavailable`     | A check's detail endpoint was unavailable        | Detail results not counted; report the gap |
| `code_analysis_count_unavailable` | Upstream omitted the code-analysis feature total | Per-feature instance counts still reported |
| `workflow_timed_out`              | Deadline reached while work was processing       | Automatic resumes per the state machine    |

## Composite error codes

Composite tools return structured errors as `{ error: { code, message, retryable, details, test_id?, reference_id? } }`:

- `INVALID_SUBJECT`, `INVALID_HTML`, `HTML_TOO_LARGE`, `INVALID_CLIENTS`, `INVALID_TIMEOUT`, `INVALID_TEST_ID`: input rejected before any request; fix the input.
- `NOT_ENTITLED`: Email Preview is not enabled for the account, or access was forbidden.
- `CREATE_REJECTED`: Mailgun rejected the create with a 4xx. Never re-POST automatically; Mailgun can reject after the test already exists, so `details` still names the subject and time window for manual reconciliation.
- `AMBIGUOUS_CREATE`, `CREATE_NO_TEST_ID`: the create outcome is uncertain (transport failure or 5xx) and no `test_id` is available. Report uncertainty and stop; `list_preview_tests` is manual troubleshooting only, filtered by `subject` and a `from`/`to` window (Unix timestamps) from `details`, never by `reference_id`.
- `POLL_FAILED_AFTER_CREATE`: the test exists; the error includes its `test_id`. Automatic `get_email_preview_qa` resumes are allowed per the state machine.
- `TEST_NOT_FOUND`: the supplied `test_id` matched no test.
- `UPSTREAM_API_ERROR`: transient upstream failure; `retryable` refers to the user re-invoking the tool, never an automatic re-create.
