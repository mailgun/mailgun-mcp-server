#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { formatHelp, formatInvalidTagsMessage, formatTagList, resolveActiveTags } from "./cli.js";
import { localConfig, OPENAPI_YAML } from "./config.js";
import { loadOpenApiSpec } from "./openapi.js";
import { buildToolCatalog, createMailgunServer } from "./server.js";

export async function main(): Promise<void> {
  try {
    const cli = resolveActiveTags(process.argv.slice(2), process.env);

    if (cli.showHelp) {
      console.log(formatHelp());
      process.exit(0);
    }

    if (cli.listTags) {
      console.log(formatTagList());
      process.exit(0);
    }

    if (cli.invalid.length > 0) {
      console.error(formatInvalidTagsMessage(cli.invalid));
      process.exit(1);
    }

    if (cli.error) {
      console.error(cli.error);
      process.exit(1);
    }

    const config = localConfig(process.env);
    if (!config) {
      console.error(
        "Error: MAILGUN_API_KEY environment variable is required. Set it in your MCP client configuration.",
      );
      process.exit(1);
    }

    const openApiSpec = loadOpenApiSpec(OPENAPI_YAML);
    const server = createMailgunServer(buildToolCatalog(openApiSpec, cli.activeTags), config);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Mailgun MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():", error);
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  main();
}
