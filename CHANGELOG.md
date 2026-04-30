# Changelog

## 2.1.0

### Added

- **New tools:** `validate_email`, `get_inbox_placement_result`, `get_preview_result`,
  and `get_metrics_summary` for email validation, inbox placement testing, email
  preview results, and sending metrics analysis.
- **Custom tool framework:** Introduced `src/custom-tools/` directory for tools that
  require logic beyond OpenAPI-to-MCP mapping.
- **Plan-aware error messages:** API errors now include actionable guidance based on
  HTTP status code (401, 403, 404, 400) with links to billing when relevant.

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
