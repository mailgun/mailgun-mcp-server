# Security

This document summarizes the Mailgun MCP Server security model for users and marketplace reviewers.

## Data flow and transport

- The server runs locally and communicates only with the Mailgun API over HTTPS.
- API hosts are selected by region (`api.mailgun.net` or `api.eu.mailgun.net`).
- The server uses stdio transport to communicate with the MCP client.

## Authentication and credentials

- Authentication uses `MAILGUN_API_KEY` from environment variables.
- API keys are consumed by the server process and are not sent to the model as tool output.
- Use a dedicated, scoped Mailgun key for MCP usage.

## Local system access

- The server does not read local files or local databases for tool execution.
- The server does not execute shell commands as part of tool handlers.

## Logging and sensitive data

- The server does not intentionally log API keys.
- API responses may contain email-related account data depending on invoked tools; run the server in trusted environments.
- The Email Preview (Inspect) detail and client-result tools can return large payloads that include rendered HTML snippets and other potentially sensitive email content. Be mindful of what is surfaced to the model.

## Operational recommendations

- Use separate API keys for development and production.
- Rotate keys periodically and immediately after suspected exposure.
- Review tool-call confirmations in MCP clients before approving write operations. Note that `run_email_preview_qa` is a mutating, quota-consuming action: it creates a remote Mailgun preview test (it does not send email).
