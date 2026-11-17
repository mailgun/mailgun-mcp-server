#!/usr/bin/env node

import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostedConfig, OPENAPI_YAML, resolveApiHostname } from "./config.js";
import { loadOpenApiSpec } from "./openapi.js";
import { buildToolCatalog, createMailgunServer, type ToolCatalog } from "./server.js";

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

export function parseBearerToken(header: string | undefined): string | undefined {
  const token = header?.match(BEARER_PATTERN)?.[1]?.trim();
  return token || undefined;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: http.OutgoingHttpHeaders = {},
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sendJsonRpcError(
  res: http.ServerResponse,
  status: number,
  message: string,
  headers: http.OutgoingHttpHeaders = {},
): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null }, headers);
}

async function handleMcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: ToolCatalog,
  hostname: string,
): Promise<void> {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    sendJsonRpcError(res, 401, "Missing or invalid Authorization: Bearer <apiKey> header.", {
      "WWW-Authenticate": "Bearer",
    });
    return;
  }

  const server = createMailgunServer(catalog, hostedConfig(token, hostname));
  // Stateless: a fresh transport per request, so no session can outlive it.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export function createHttpServer(catalog: ToolCatalog, hostname: string): http.Server {
  return http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/_health" && req.method === "GET") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (path !== "/mcp") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (req.method !== "POST") {
      sendJsonRpcError(res, 405, "Method not allowed.", { Allow: "POST" });
      return;
    }

    handleMcpRequest(req, res, catalog, hostname).catch((error: unknown) => {
      console.error("Error handling MCP request:", (error as Error).message);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, "Internal server error.");
      }
    });
  });
}

export function main(): void {
  if (process.env.MAILGUN_MCP_TAGS?.trim()) {
    console.error(
      "Error: MAILGUN_MCP_TAGS is not supported on the HTTP entrypoint; all tools are always loaded. Unset it and restart.",
    );
    process.exit(1);
  }

  const catalog = buildToolCatalog(loadOpenApiSpec(OPENAPI_YAML), "all");
  const hostname = resolveApiHostname(process.env);
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";

  createHttpServer(catalog, hostname).listen(port, host, () => {
    console.error(`Mailgun MCP Server running on http://${host}:${port}/mcp`);
  });
}

if (process.env.NODE_ENV !== "test") {
  main();
}
