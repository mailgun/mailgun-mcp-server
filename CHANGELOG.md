# Changelog

## 2.3.0

### Added

- **Opt-in on-demand loading.** `--tags dynamic` (or `MAILGUN_MCP_TAGS=dynamic`) starts
  the server with 15 core tools plus 3 "tool-loading" tools instead of all 73, about
  29 KB of tool definitions instead of about 68 KB. The model calls
  `mailgun_list_toolsets` and `mailgun_enable_toolset` to load more tools, and the
  server sends `notifications/tools/list_changed` when it does. `mailgun_call_tool` runs
  read-only tools by name, whether or not their toolset is loaded, for clients that
  don't refresh their tool list, and refuses core tools and tools that change data.
  The default is unchanged: every tool loads at startup.
- **Toolsets.** The `send` tag is split into `send.<group>` toolsets (`send.messages`,
  `send.domains`, `send.webhooks`, `send.account`, `send.message_tags`,
  `send.analytics`, `send.suppressions`, `send.routes`, `send.lists`,
  `send.templates`); `validate`, `optimize`, and `inspect` are toolsets of their own.
  `--tags` accepts toolset IDs, `core`, `all`, and `dynamic`, and `send` still matches every
  `send.<group>` toolset. `--list-tags` prints every value with a description.
- **`readOnlyHint` annotations** on every tool.
- **`_meta["com.mailgun/toolset"]`** on every tool, next to
  `_meta["com.mailgun/tags"]`.

### Dependencies

- Raised the `@modelcontextprotocol/sdk` minimum version to `^1.24.0`, the first version
  with zod 4 support and the tool handler API needed for this release.

## 2.2.0

### Removed

- Removed all deprecated `GET /v1/bounce-classification/...` endpoints. 
  Use the `POST /v2/bounce-classification/metrics` endpoint instead.

## 2.1.0

### Added

- **Multi-product coverage.** The OpenAPI driven tool registry now spans four
  Mailgun products — `send`, `validate`, `optimize`, and `inspect`. Endpoints are
  drawn from a curated allowlist, mapped to MCP tools from the bundled OpenAPI
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
