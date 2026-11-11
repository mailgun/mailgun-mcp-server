# Mailgun MCP Server

[![npm version](https://img.shields.io/npm/v/@mailgun/mcp-server.svg)](https://www.npmjs.com/package/@mailgun/mcp-server)
[![MCP](https://img.shields.io/badge/MCP-Server-blue.svg)](https://github.com/modelcontextprotocol)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)

## Overview

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Mailgun](https://mailgun.com) that gives AI agents a practical, workflow-oriented interface to send email, diagnose deliverability, and manage account operations.

> [!NOTE]
> This MCP server runs locally on your machine and communicates over stdio. Mailgun does not currently offer a hosted version of this server.

### Capabilities

- **Messaging**: Send emails, retrieve stored messages, resend messages
- **Domains**: View domain details, verify DNS configuration, manage tracking settings (click, open, unsubscribe)
- **Webhooks**: List, create, and update event webhooks
- **Routes**: View and update inbound email routing rules
- **Mailing Lists**: Create, view, and update mailing lists and their members
- **Templates**: Create, view, and update email templates with versioning
- **Analytics**: Query sending metrics, usage metrics, and logs
- **Stats**: View aggregate statistics by domain, tag, provider, device, and country
- **Suppressions**: View bounces, unsubscribes, complaints, and allowlist entries
- **IPs & IP Pools**: View IP assignments and dedicated IP pool configuration
- **Bounce Classification**: Analyze bounce types and delivery issues
- **Validation**: Validate email address deliverability and syntax before sending (`validate`)
- **Optimize (Inbox Placement)**: Retrieve inbox placement and seed test results to gauge deliverability (`optimize`)
- **Inspect (Email Preview)**: Retrieve email rendering and preview test results across clients, and run the [Email Preview QA](#email-preview-qa-inspect) create/resume workflow (`inspect`)
- **Account Limits**: View custom monthly sending limits

The labels above (`validate`, `optimize`, `inspect`) are the product tags used by [tag filtering](#tag-filtering). Every other capability is registered under the `send` tag, which is split into `send.<group>` [toolsets](#on-demand-toolsets).

> [!NOTE]
> Most tools are read and update operations, and no delete operations are exposed, which keeps the blast radius of an unintended action small. One exception is `run_email_preview_qa`, which creates a remote Mailgun preview test and consumes preview quota (it does not send email). See [Email Preview QA](#email-preview-qa-inspect) and [Security Considerations](#security-considerations). This server should not be described as read-only.

### How it works

The server is OpenAPI driven. At startup it parses a bundled Mailgun OpenAPI spec and registers a curated allowlist of endpoints as MCP tools, generating each tool's input schema (via Zod) from the spec. Every tool is annotated with a Mailgun product tag (`send`, `validate`, `optimize`, or `inspect`), the toolset it belongs to, and whether it only reads data.

By default the server loads every tool at startup. With `--tags dynamic`, it loads a small [core set of tools](#on-demand-toolsets) plus three tools the model uses to load more toolsets on demand, which keeps the tool definitions sent to the model small. [Tag filtering](#tag-filtering) loads a fixed set of tools at startup instead, so a given workflow can expose exactly the products it needs.

## Prerequisites

- Node.js (v20.12 or higher)
- Mailgun account and API key

## Installation

The server is published to npm as [`@mailgun/mcp-server`](https://www.npmjs.com/package/@mailgun/mcp-server) and runs over stdio. Most clients can launch it on demand with `npx`, so there's nothing to install globally. In each snippet below, replace `YOUR-mailgun-api-key` with a key from your [Mailgun API security settings](https://app.mailgun.com/settings/api_security).

> [!TIP]
> If your account is hosted in Mailgun's EU region, add `"MAILGUN_API_REGION": "eu"` to the `env` block (or `-e MAILGUN_API_REGION=eu` on the CLI). It defaults to `us`.

### Claude Code

```bash
claude mcp add mailgun -e MAILGUN_API_KEY=YOUR-mailgun-api-key -- npx -y @mailgun/mcp-server
```

Then run `/mcp` in Claude Code to confirm the **mailgun** server is connected.

### Claude Desktop

Open **Settings → Developer → Edit Config**, or edit the file directly:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mailgun": {
      "command": "npx",
      "args": ["-y", "@mailgun/mcp-server"],
      "env": {
        "MAILGUN_API_KEY": "YOUR-mailgun-api-key",
        "MAILGUN_API_REGION": "us"
      }
    }
  }
}
```

### Cursor

Open the command palette and choose **Cursor Settings → MCP → Add new global MCP server**, then add:

```json
{
  "mcpServers": {
    "mailgun": {
      "command": "npx",
      "args": ["-y", "@mailgun/mcp-server"],
      "env": {
        "MAILGUN_API_KEY": "YOUR-mailgun-api-key"
      }
    }
  }
}
```

### Codex

```bash
codex mcp add mailgun \
  --env MAILGUN_API_KEY=YOUR-mailgun-api-key \
  -- npx -y @mailgun/mcp-server
```

### VS Code (GitHub Copilot)

Add the following to your `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "mailgun": {
        "command": "npx",
        "args": ["-y", "@mailgun/mcp-server"],
        "env": {
          "MAILGUN_API_KEY": "YOUR-mailgun-api-key"
        }
      }
    }
  }
}
```

### Windsurf

```json
{
  "mcpServers": {
    "mailgun": {
      "command": "npx",
      "args": ["-y", "@mailgun/mcp-server"],
      "env": {
        "MAILGUN_API_KEY": "YOUR-mailgun-api-key"
      }
    }
  }
}
```

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "mailgun": {
      "command": "npx",
      "args": ["-y", "@mailgun/mcp-server"],
      "env": {
        "MAILGUN_API_KEY": "YOUR-mailgun-api-key"
      }
    }
  }
}
```

## Configuration

### Environment variables

| Variable               | Required | Default              | Description                                                                                 |
| ---------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `MAILGUN_API_KEY`      | Yes      | (none)               | Your Mailgun API key                                                                        |
| `MAILGUN_API_REGION`   | No       | `us`                 | API region: `us` or `eu`                                                                     |
| `MAILGUN_API_HOSTNAME` | No       | (derived from region) | Override the API hostname (e.g. `api.eu.mailgun.net`). Takes precedence over the region.     |
| `MAILGUN_MCP_TAGS`     | No       | (all)                | Comma-separated tags or toolsets to load, or `dynamic` for core tools with more loaded on demand. Equivalent to `--tags`. The CLI flag takes precedence. |

### CLI options

Pass flags after the package name in your client's `args` (e.g. `["-y", "@mailgun/mcp-server", "--tags", "validate,inspect"]`).

| Flag              | Description                                                                             |
| ----------------- | -------------------------------------------------------------------------------------- |
| `--tags <list>`   | Comma-separated tags or toolsets to load (default: all). Valid: `all`, `dynamic`, `core`, `send`, `validate`, `optimize`, `inspect`, and the `send.<group>` toolsets. |
| `--list-tags`     | Print every valid `--tags` value with a description and exit.                         |
| `--help`, `-h`    | Show usage and exit.                                                                    |

### On-demand toolsets

With `--tags dynamic` (or `MAILGUN_MCP_TAGS=dynamic`), the server starts with these core tools:

| Tool                                    | Purpose                         |
| --------------------------------------- | ------------------------------- |
| `post-v3-domain-messages`               | Send an email                   |
| `get-v4-domains`                        | List domains                    |
| `get-v4-domains-name`                   | Domain details and DNS records  |
| `put-v4-domains-name-verify`            | Re-check a domain's DNS records |
| `get-v3-domains-name-tracking`          | Tracking settings               |
| `get_metrics_summary`                   | Summary of key sending metrics  |
| `post-v1-analytics-metrics`             | Query account metrics           |
| `post-v1-analytics-logs`                | Query event logs                |
| `post-v2-bounce-classification-metrics` | Bounce classification metrics   |
| `get-v3-domain-bounces`                 | List bounces                    |
| `get-v3-domain-bounces-address`         | Look up a bounce record         |
| `get-v3-domain-unsubscribes`            | List unsubscribes               |
| `get-v3-domain-complaints`              | List complaints                 |
| `get-v3-domain-templates`               | List templates                  |
| `validate_email`                        | Validate an email address       |

Every tool belongs to a toolset. The model loads the rest of a toolset when a task needs it:

| Toolset             | Tools | Contents                                                                 |
| ------------------- | ----- | ------------------------------------------------------------------------ |
| `send.messages`     | 3     | Send email; retrieve and resend stored messages                          |
| `send.domains`      | 8     | Domains, DNS verification, sending queues, tracking settings             |
| `send.webhooks`     | 4     | Domain webhooks                                                          |
| `send.account`      | 8     | Account IPs, dedicated IP pools, custom sending limits                   |
| `send.message_tags` | 8     | Message tags, stats by tag, tag limits                                   |
| `send.analytics`    | 12    | Stats and aggregates, analytics metrics and logs, bounce classification  |
| `send.suppressions` | 8     | Bounces, unsubscribes, complaints, allowlist                             |
| `send.routes`       | 3     | Inbound routes                                                           |
| `send.lists`        | 8     | Mailing lists and members                                                |
| `send.templates`    | 8     | Templates and template versions                                          |
| `validate`          | 1     | Email address validation                                                 |
| `optimize`          | 1     | Inbox placement test results                                             |
| `inspect`           | 11    | Email preview QA: run and resume tests, client renders, check results    |

The model loads toolsets with three extra tools:

- **`mailgun_list_toolsets`** lists every toolset and its tools, marking which are loaded and which change data. Given a tool name, it returns that tool's input schema instead.
- **`mailgun_enable_toolset`** loads one or more toolsets. The server then notifies the client that its tool list changed (`notifications/tools/list_changed`), and the new tools appear alongside the core ones. The response lists the new tools without their input schemas, which come with the updated tool list.
- **`mailgun_call_tool`** runs a read-only tool by name, whether or not its toolset is loaded. It's a fallback for clients that don't refresh their tool list after a change. It refuses core tools and tools that change data, so those always run as their own tool call.

Loaded toolsets last until the client disconnects. On-demand loading needs a client that refreshes its tool list when the server reports a change; Claude Code does. In clients that don't, newly loaded tools won't appear: read-only tools still work through `mailgun_call_tool`, and tools that change data need the default (all tools) or [`--tags`](#tag-filtering), for example `--tags core,send.templates`.

### Tag filtering

Setting `--tags` or `MAILGUN_MCP_TAGS` to anything other than `dynamic` loads exactly the matching tools at startup, without the loading tools. Use it to narrow the tools shown to the model (for example, only validation tools for a workflow that doesn't send email).

Valid values (run `--list-tags` for descriptions):

- `all` — every tool (the default)
- `dynamic` — the core tools, with other toolsets loaded [on demand](#on-demand-toolsets). Use it on its own; combining it with other values fails at startup.
- `core` — only the core tools listed above
- `send`, `validate`, `optimize`, `inspect` — every tool for that product (`send` covers every `send.<group>` toolset)
- A toolset ID such as `send.templates`

Filtering uses **OR semantics**: a tool is loaded if it matches any value in the list. For example, `core,send.templates` loads the core tools plus every template tool.

**Via CLI flag:** pass `--tags` in your MCP client config's `args`:

```json
{
  "mcpServers": {
    "mailgun": {
      "command": "npx",
      "args": ["-y", "@mailgun/mcp-server", "--tags", "validate,inspect"],
      "env": {
        "MAILGUN_API_KEY": "YOUR-mailgun-api-key"
      }
    }
  }
}
```

**Via environment variable:** set `MAILGUN_MCP_TAGS` (CLI flag wins if both are present):

```json
"env": {
  "MAILGUN_API_KEY": "YOUR-mailgun-api-key",
  "MAILGUN_MCP_TAGS": "validate,inspect"
}
```

> [!TIP]
> Run the binary with `--list-tags` to print every valid value, or `--help` for full usage. Unknown values are rejected at startup with a clear error message.

## Email Preview QA (Inspect)

The `inspect` product exposes an Email Preview QA workflow for checking how an HTML email renders across clients and what structured checks (links, images, accessibility, code analysis) report. It is built from two composite tools plus a set of lower level read primitives.

### Composite tools

- **`run_email_preview_qa`** creates a preview test and summarizes it. This CREATES one remote Mailgun preview test and CONSUMES preview quota. It does not send email. The tool issues exactly one create request, polls the render and checks until they settle or the timeout is reached, and returns counts and result references. V2 creation is not idempotent, so the tool never auto retries the create. On a timeout it returns partial results with `timed_out=true` (resume with `get_email_preview_qa`); on an ambiguous transport failure or 5xx it reports that a test may have been created and recommends reconciling with `list_preview_tests` (by subject and a time window around the create, since `reference_id` is not stored upstream) rather than creating another.
- **`get_email_preview_qa`** resumes and summarizes an existing test by `test_id`. It only reads (it never creates a test), so it is the tool to use for polling a long running test or picking up after a timeout.

### Inputs

- **HTML only.** The V1 input source is the rendered `html` string plus a `subject`. URL, MIME, ZIP, and template sources are not supported. The `html` is capped at 5 MiB and rejected before any request.
- **Content checks.** `content_checks` defaults to all four checks (`link_validation`, `image_validation`, `accessibility`, `code_analysis`). Pass a subset to run only those, or an empty list to run none.
- **Clients.** Omitting `clients` uses Mailgun's server default client set. To select clients explicitly, pass ids from the V1 preview client catalog (`list_preview_clients`), which is authoritative for explicit client selection. Every client id must be a non-empty string; a blank or invalid id rejects the whole request.
- **Timeout.** `timeout_seconds` is an integer from 0 to 45 (default 45). Values outside that range, and fractional values, are rejected before any network request is made. The budget covers the whole tool call, including the create request, and no request is left running past 45 seconds, so the call returns before common 60 second MCP client limits. A test that is still processing comes back with `timed_out=true` and its `test_id`; resume it with `get_email_preview_qa`.

### Output and semantics

- The composites return counts and result references (per check status, failure and severity tallies, per client render status, and any `data_gaps`). They do not return raw upstream payloads, individual issue records, or rendered HTML.
- **No Mailgun-authored pass/fail.** The workflow does not emit a top level verdict. Quality gating is owned by the customer: the tool reports what the checks found and leaves the judgment to you.
- Slow client renders never block completion. Completion is driven by the checks, and a straggling client is reported per client plus a non-fatal `render_incomplete` gap.

### Read primitives

The lower level `inspect` tools back the composites and can be called directly: `list_preview_tests`, `get_preview_test_status`, `get_preview_client_result`, `list_preview_clients`, the per check detail tools (links, images, accessibility, analyze), and the V1 aggregate `get_preview_result` (kept for compatibility).

> [!NOTE]
> The detail and client result tools can return large payloads that include rendered HTML snippets and other potentially sensitive content. Run the server in trusted environments and review what is surfaced to the model.

> [!NOTE]
> Preview test creation is a mutating, quota-consuming action. A broader, MCP-wide review of mutation safety (confirmation prompts, write gating) is tracked as a separate follow-up and is intentionally not added as preview-only policy here.

### Optional Agent Skill: Inspect Email Preflight

The npm package ships an optional [Agent Skill](https://agentskills.io) at `skills/mailgun-inspect-preflight/` that turns natural-language email QA requests ("preflight this email before we send it") into safe, consistent Inspect workflows. It is an additive layer: the MCP tools behave identically without it, and all validation, polling, and create-safety behavior lives in the server.

The skill requires this MCP server to be configured with the `inspect` tools enabled (the default, `--tags` including `inspect`, or `--tags dynamic`, where the skill loads the `inspect` toolset with `mailgun_enable_toolset`). Install it manually by copying the skill folder from the installed package (or a repo checkout) into your client's skills directory:

```sh
# Find the packaged skill (after installing @mailgun/mcp-server)
SKILL_SRC="$(npm root -g)/@mailgun/mcp-server/skills/mailgun-inspect-preflight"
```

- **Claude Code**: copy to `.claude/skills/` in your project (or `~/.claude/skills/` for all projects), then start a new session.

  ```sh
  cp -R "$SKILL_SRC" .claude/skills/
  ```

- **Codex**: copy to `.agents/skills/` in your project (or `~/.agents/skills/` for all projects; older Codex versions use `~/.codex/skills/`), then restart Codex. The bundled `agents/openai.yaml` is optional presentation metadata; `SKILL.md` alone is sufficient.

  ```sh
  cp -R "$SKILL_SRC" .agents/skills/
  ```

- **Cursor**: copy to `.cursor/skills/` in your project (Cursor skills are project-scoped), then reload the window (`Cmd/Ctrl+Shift+P` → "Developer: Reload Window").

  ```sh
  cp -R "$SKILL_SRC" .cursor/skills/
  ```

After installation, verify discovery by asking the agent to "preflight an email" and confirming it announces the skill's profile and check selection before running `run_email_preview_qa`.

## Sample Prompts

#### Send an Email

```
Can you send an email to EMAIL_HERE with a funny email body that makes it sound
like it's from the IT Desk from Office Space? Please use the sending domain
DOMAIN_HERE, and make the email from "postmaster@DOMAIN_HERE"!
```

> [!NOTE]
> Some MCP clients require a paid plan to invoke tools that send data. If sending fails silently, check your client's plan.

#### Fetch and Visualize Sending Statistics

```
Would you be able to make a chart with email delivery statistics for the past week?
```

#### Manage Templates

```
Create a welcome email template for new signups on my domain DOMAIN_HERE.
Include a personalized greeting and a call-to-action button.
```

#### Investigate Deliverability

```
Can you check the bounce classification stats for my account and tell me
what the most common bounce reasons are?
```

#### Troubleshoot DNS

```
Check the DNS verification status for my domain DOMAIN_HERE and tell me
if anything needs fixing.
```

#### Review Suppressions

```
Are there any unsubscribes or complaints for DOMAIN_HERE? Summarize the
top offenders.
```

#### Manage Routing Rules

```
List all my inbound routes and explain what each one does.
```

#### Create a Mailing List

```
Create a mailing list called announcements@DOMAIN_HERE and add these
members: alice@example.com, bob@example.com.
```

#### Compare Domains

```
Compare my sending volume and delivery rates across all my domains for
the past month.
```

#### Engagement by Region

```
Break down my email engagement by country and device for DOMAIN_HERE.
```

#### Review Tracking Settings

```
List all my domains and show which ones have tracking enabled for clicks
and opens.
```

#### Validate an Email Address

```
Validate the email address EMAIL_HERE and tell me whether it's safe to send to.
```

#### Check Inbox Placement (Optimize)

```
Pull the inbox placement results for seed test RESULT_ID_HERE and summarize
where my message landed (inbox, spam, or missing) by provider.
```

#### Preview an Email (Inspect)

```
Get the email preview results for test TEST_ID_HERE and tell me if the email
renders correctly across clients.
```

#### Run an Email Preview QA (Inspect)

```
Run an email preview QA on this HTML and tell me about any broken links, image
issues, or accessibility problems. This creates a Mailgun preview test and uses
preview quota. Subject "Spring sale", HTML: <HTML_HERE>
```

## Development

### Run from source

The server is written in TypeScript. Clone, install, build, and test:

```bash
git clone https://github.com/mailgun/mailgun-mcp-server.git
cd mailgun-mcp-server
npm install
npm run build
npm test
```

`npm run build` compiles `src/` to `dist/` and copies the bundled OpenAPI spec. Point your MCP client at the built entry instead of `npx` (use an absolute path):

```json
{
  "mcpServers": {
    "mailgun": {
      "command": "node",
      "args": ["/absolute/path/to/mailgun-mcp-server/dist/mailgun-mcp.js"],
      "env": {
        "MAILGUN_API_KEY": "YOUR-mailgun-api-key"
      }
    }
  }
}
```

### Live testing while you edit

MCP servers are long-lived stdio processes that don't hot-reload, so the loop is: rebuild on save, then reconnect the client to pick up changes.

1. Run `npm run build` once so `dist/openapi.yaml` is in place.
2. Keep the TypeScript compiler running to rebuild `dist/` on every save:

   ```bash
   npx tsc --watch
   ```

3. Point a separate MCP client (or MCP Inspector, below) at `dist/mailgun-mcp.js`. After a change, restart the MCP client session to load the new build.

### Testing with MCP Inspector

The [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) lets you exercise tools without a full client. Build first, then launch it against the built server:

```bash
npm run build
MAILGUN_API_KEY=YOUR-mailgun-api-key npx @modelcontextprotocol/inspector node dist/mailgun-mcp.js
```

Open the Inspector UI, click **Connect**, then use **List Tools** to verify the server is working. To test a filtered toolset, append flags after the server path:

```bash
MAILGUN_API_KEY=YOUR-mailgun-api-key npx @modelcontextprotocol/inspector node dist/mailgun-mcp.js --tags validate,inspect
```

### Pre-commit hooks

`npm install` installs a git pre-commit hook (via husky) that runs `oxlint --fix` and `oxfmt` on staged TypeScript/JavaScript files and runs `npm run check:versions`. Fixable issues are auto-fixed and re-staged; commits that introduce unfixable lint errors or version-sync mismatches are rejected. If you already had a local clone before this change, run `npm install` once to install the hook.

### Note on adding [endpoints](https://github.com/mailgun/mailgun-mcp-server/blob/main/src/endpoints.ts)
Endpoints are grouped by toolset in `endpointGroups`. A plain string entry takes its product tag from its toolset (`send.templates` → `send`) and is treated as read-only only if it's a `GET`. Use the object form of `EndpointEntry` to set a tool name, mark a tool as `core` (loaded at startup in dynamic mode), or mark a `POST` that only queries data as `readOnly: true`.

## Security Considerations

### API key isolation

Your Mailgun API key is passed as an environment variable and is never exposed to the AI model itself. It is only used by the MCP server process to authenticate requests. The server does not log API keys, request parameters, or response data.

### Local execution

The server runs locally on your machine. All communication with the Mailgun API is over HTTPS with TLS certificate validation enforced. No data is sent to third-party services beyond the Mailgun API.

### API key permissions

Use a dedicated Mailgun API key with permissions scoped to only the operations you need. The server exposes read and update operations and does not expose any delete operations, which limits the blast radius of unintended actions. Note that `run_email_preview_qa` is a create operation: it provisions a remote Mailgun preview test and consumes preview quota, so scope keys accordingly.

### Rate limiting

The server does not implement client-side rate limiting. Each tool call from the AI translates directly into a Mailgun API request. The server relies on Mailgun's server-side rate limits to prevent abuse; requests that exceed those limits will return an error to the AI assistant.

### Prompt injection

As with any MCP server, a crafted or adversarial prompt could trick the AI assistant into calling operations you did not intend, such as modifying tracking settings, creating a preview test, or reading mailing list members. Review your AI assistant's tool-call confirmations before approving actions, especially in untrusted prompt contexts.

### Tool loading and approvals

Every tool carries the MCP `readOnlyHint` annotation, so clients can tell tools that only read data from tools that change it (for example when asking for approval). `mailgun_list_toolsets` and `mailgun_call_tool` are read-only. `mailgun_enable_toolset` changes which tools the session sees, so it isn't marked read-only, but it never changes anything in Mailgun. `mailgun_call_tool` runs only read-only tools that aren't in the core set, so approving it can never send email or change account settings. Tools that change data always run as their own tool call.

Loading toolsets on demand reduces what the model sees; it isn't an access control, because the model can load any toolset. To limit which tools the server exposes at all, use [`--tags`](#tag-filtering).

### Webhook URLs

Webhook create and update operations accept arbitrary URLs provided through the AI assistant. The MCP server passes these URLs to the Mailgun API without additional validation. Mailgun is responsible for validating webhook destinations. Ensure your AI assistant does not set webhook URLs to unintended internal or sensitive addresses.

### Input validation

All tool parameters are validated against the Mailgun OpenAPI specification using Zod schemas. However, validation depends on the accuracy of the OpenAPI spec, and some edge-case parameters may fall back to permissive validation. The Mailgun API performs its own server-side validation as an additional layer of protection.

## Debugging

The MCP server communicates over stdio. Refer to the [MCP Debugging Guide](https://modelcontextprotocol.io/docs/tools/debugging) for troubleshooting.

## License

Apache 2.0. See [LICENSE](LICENSE) for details.

## Contributing

We welcome contributions! Please feel free to submit a [Pull Request](https://github.com/mailgun/mailgun-mcp-server/pulls) or open an [Issue](https://github.com/mailgun/mailgun-mcp-server/issues).
