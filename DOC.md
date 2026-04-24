# Mailgun MCP Server

Connect MCP-compatible clients (Claude Desktop, Claude Code, Cursor, and others) to a workflow-oriented Mailgun interface so agents can send email, diagnose deliverability issues, and take practical account actions.

## Features

- Send email and retrieve stored message content.
- Manage domains and verify DNS status.
- Configure tracking options and webhooks.
- Manage routes, mailing lists, and templates.
- Query analytics, aggregate stats, suppressions, IPs, and account limits.
- Analyze bounce classification metrics.

## Prerequisites

- Node.js 20.12 or newer.
- A Mailgun account and API key.
- An MCP-compatible client.

## Setup

Use the server with stdio and `npx`:

```json
{
  "mcpServers": {
    "mailgun": {
      "command": "npx",
      "args": ["-y", "@mailgun/mcp-server"],
      "env": {
        "MAILGUN_API_KEY": "YOUR_MAILGUN_API_KEY",
        "MAILGUN_API_REGION": "us"
      }
    }
  }
}
```

## Environment variables

- `MAILGUN_API_KEY` (required): Mailgun API key.
- `MAILGUN_API_REGION` (optional): `us` or `eu` (default `us`).

## Security notes

- The server runs locally.
- It communicates only with Mailgun HTTPS APIs.
- It does not read local files or databases for tool execution.

For deeper details, see `README.md` and `SECURITY.md`.
