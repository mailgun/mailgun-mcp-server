# Mailgun MCP Server
[![MCP](https://img.shields.io/badge/MCP-Server-blue.svg)](https://github.com/modelcontextprotocol)

## Overview
A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Mailgun](https://mailgun.com), enabling MCP-compatible AI clients to interact with the Mailgun email service.

### Capabilities

- **Messaging** — Send emails, retrieve stored messages, resend messages
- **Domains** — View domain details, verify DNS configuration, manage tracking settings (click, open, unsubscribe)
- **Webhooks** — List, create, update, and delete event webhooks
- **Routes** — View and update inbound email routing rules
- **Mailing Lists** — Create and manage mailing lists and their members
- **Templates** — Create and manage email templates with versioning
- **Analytics** — Query sending metrics, usage metrics, and logs
- **Stats** — View aggregate statistics by domain, tag, provider, device, and country
- **Suppressions** — View bounces, unsubscribes, complaints, and allowlist entries
- **IPs & IP Pools** — View IP assignments and dedicated IP pool configuration
- **Bounce Classification** — Analyze bounce types and delivery issues

## Prerequisites

- Node.js (v18 or higher)
- Mailgun account and API key

## Quick Start

### Configuration

Add the following to your MCP client configuration:

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

#### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MAILGUN_API_KEY` | Yes | — | Your Mailgun API key |
| `MAILGUN_API_REGION` | No | `us` | API region: `us` or `eu` |

#### Client-Specific Config Paths

- **Claude Desktop** (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop** (Windows): `%APPDATA%/Claude/claude_desktop_config.json`
- **Claude Code**: Run `claude mcp add` or edit `~/.claude.json`

## Sample Prompts

#### Send an Email
```
Can you send an email to EMAIL_HERE with a funny email body that makes it sound
like it's from the IT Desk from Office Space? Please use the sending domain
DOMAIN_HERE, and make the email from "postmaster@DOMAIN_HERE"!
```

> Note: some MCP clients require a paid plan to invoke tools that send data. If sending fails silently, check your client's plan.

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

## Development

To run from source, clone the repository and use `node` directly:

```bash
git clone https://github.com/mailgun/mailgun-mcp-server.git
cd mailgun-mcp-server
npm install
npm test
```

In your MCP client config, replace the `npx` command with:

```json
"command": "node",
"args": ["/path/to/mailgun-mcp-server/src/mailgun-mcp.js"]
```

## Debugging

The MCP server communicates over stdio. Refer to the [MCP Debugging Guide](https://modelcontextprotocol.io/docs/tools/debugging) for troubleshooting.

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

## Contributing

We welcome contributions! Please feel free to submit a [Pull Request](https://github.com/mailgun/mailgun-mcp-server/pulls) or open an [Issue](https://github.com/mailgun/mailgun-mcp-server/issues).
