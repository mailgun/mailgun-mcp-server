# Mailgun MCP Server
[![MCP](https://img.shields.io/badge/MCP-Server-blue.svg)](https://github.com/modelcontextprotocol)
[![smithery badge](https://smithery.ai/badge/@mailgun/mailgun-mcp-server)](https://smithery.ai/server/@mailgun/mailgun-mcp-server)

## Overview
A Model Context Protocol (MCP) server implementation for [Mailgun](https://mailgun.com), enabling MCP-compatible AI clients like Claude Desktop to interract with the service.

## Prerequisites

- Node.js (v18 or higher)
- Git
- Claude Desktop (for Claude integration)
- Mailgun account and an API key

## Quick Start

### Installing via Smithery

To install Mailgun MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@mailgun/mailgun-mcp-server):

```bash
npx -y @smithery/cli install @mailgun/mailgun-mcp-server --client claude
```

### Manual Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/mailgun/mailgun-mcp-server.git
   cd mailgun-mcp-server
   ```

2. Install dependencies and build:
   ```bash
   npm install
   ```

3. Configure Claude Desktop:

   Create or modify the config file:
   - MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%/Claude/claude_desktop_config.json`

   Add the following configuration:
   ```json
   {
       "mcpServers": {
           "mailgun": {
               "command": "node",
               "args": ["CHANGE/THIS/PATH/TO/mailgun-mcp-server/src/mailgun-mcp.js"],
               "env": {
                   "MAILGUN_API_KEY": "YOUR-mailgun-api-key"
               }
           }
       }
   }
   ```

## Testing

Run the local test suite with:

```bash
NODE_ENV=test npm test
```

### Sample Prompts with Claude

#### Send an Email

> Note: sending an email currently (2025-03-18) seems to require a paid account with Anthropic. You'll get a silent failure on the free account

```
Can you send an email to EMAIL_HERE with a funny email body that makes it sound like it's from the IT Desk from Office Space?
Please use the sending domain DOMAIN_HERE, and make the email from "postmaster@DOMAIN_HERE"!
```

#### Fetch and Visualize Sending Statistics

```
Would you be able to make a chart with email delivery statistics for the past week?
```

## Debugging

The MCP server communicates over stdio, please refer to [Debugging](https://modelcontextprotocol.io/docs/tools/debugging) section of the Model Context Protocol.

## License

[LICENSE](LICENSE) file for details

## Contributing

We welcome contributions! Please feel free to submit a Pull Request.
