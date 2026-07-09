# Changelog

## 2.1.0

### Added

- **Multi-product coverage.** The OpenAPI-driven tool registry now spans four
  Mailgun products — `send`, `validate`, `optimize`, and `inspect`. Endpoints are
  drawn from a curated allow-list, mapped to MCP tools from the bundled OpenAPI
  spec, and annotated with a product tag; all matching tools are registered at
  startup (scoped by tag filtering, see below). New endpoints added this release:
  - **Validation** — `validate_email` (`GET /v4/address/validate`) checks address
    deliverability and syntax before sending. Tagged `validate`.
  - **Optimize / Inbox Placement** — `get_inbox_placement_result`
    (`GET /v4/inbox/results/{result}`) retrieves seed/inbox placement test results.
    Tagged `optimize`.
  - **Inspect / Email Preview** — `get_preview_result`
    (`GET /v1/preview/tests/{test_id}/results`) retrieves email rendering/preview
    test results. Tagged `inspect`.
- **New analytics tool:** `get_metrics_summary` for a convenient rollup of sending
  metrics analysis.
- **Custom tool framework:** Introduced `src/custom-tools/` directory for tools that
  require logic beyond OpenAPI-to-MCP mapping.
- **Plan-aware error messages:** API errors now include actionable guidance based on
  HTTP status code (401, 403, 404, 400) with links to billing when relevant.
- **Tag-based tool filtering.** Operators can now scope which tools the server
  registers via the `--tags` CLI flag or `MAILGUN_MCP_TAGS` env var (values: `send`,
  `validate`, `optimize`, `inspect`). CLI takes precedence over the env var, and
  filtering uses OR semantics. Adds `--help` and `--list-tags` for discoverability.
  Every registered tool also carries a `_meta["com.mailgun/tags"]` annotation for
  downstream client-side filtering.

### Changed

- `makeMailgunRequest` now rejects with `MailgunApiError` (carrying `statusCode` and
  `apiMessage`) instead of a generic `Error`.

### Maintenance

- Split monolithic test file into module-specific test files under `test/`.

## 2.0.0

### Breaking (runtime)

- **Dropped Node 18 support.** The minimum required Node.js version is now **20.12.0**.
  Node 18 reached end-of-life on April 30, 2025, and current dev dependencies
  (vitest 4.x / rolldown) require `node:util.styleText` which was introduced in
  Node 20.12.
- **Shortened MCP tool IDs.** Redundant `_name` suffixes are now stripped from
  path-parameter segments in tool IDs (e.g. `get-v3-domain_name-templates-template_name`
  becomes `get-v3-domain-templates-template`). This keeps combined server + tool
  name lengths within common client/API 60-character limit. Consumers that reference tool
  IDs by name will need to update to the new shorter names.

### Maintenance

- Convert the codebase to Typescript
- Switched to vitest for testing
