import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { makeMailgunRequest } from "../src/api.js";
import { createHttpServer, parseBearerToken } from "../src/http.js";
import { loadOpenApiSpec } from "../src/openapi.js";
import { buildToolCatalog } from "../src/server.js";

vi.mock("../src/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/api.js")>()),
  makeMailgunRequest: vi.fn<() => Promise<unknown>>(async () => ({ items: [] })),
}));

const HOSTNAME = "api.eu.mailgun.net";
const catalog = buildToolCatalog(
  loadOpenApiSpec(new URL("../src/openapi.yaml", import.meta.url).pathname),
  "all",
);

let httpServer: Server;
let baseUrl: string;

beforeAll(async () => {
  httpServer = createHttpServer(catalog, HOSTNAME);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
});

beforeEach(() => {
  vi.mocked(makeMailgunRequest).mockClear();
});

async function connect(apiKey: string): Promise<Client> {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    }),
  );
  return client;
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  },
};

function postMcp(headers: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(initialize),
  });
}

describe("parseBearerToken()", () => {
  test.each([
    ["Bearer key-1", "key-1"],
    ["bearer key-1", "key-1"],
    ["Bearer   key-1  ", "key-1"],
  ])("reads %j", (header, token) => {
    expect(parseBearerToken(header)).toBe(token);
  });

  test.each([undefined, "", "Bearer", "Bearer   ", "Basic YXBpOmtleQ==", "key-1"])(
    "rejects %j",
    (header) => {
      expect(parseBearerToken(header)).toBeUndefined();
    },
  );
});

describe("HTTP entrypoint", () => {
  test("/_health answers without auth", async () => {
    const res = await fetch(`${baseUrl}/_health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test.each([
    ["no Authorization header", {}],
    ["an empty bearer", { Authorization: "Bearer " }],
    ["a Basic header", { Authorization: "Basic YXBpOmtleQ==" }],
  ])("rejects /mcp with %s", async (_label, headers) => {
    const res = await postMcp(headers);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Bearer/);
  });

  test("rejects GET /mcp in stateless mode", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { headers: { Authorization: "Bearer key-1" } });
    expect(res.status).toBe(405);
  });

  test("returns 404 for unknown paths", async () => {
    expect((await fetch(`${baseUrl}/nope`)).status).toBe(404);
  });

  test("lists tools with a bearer", async () => {
    const client = await connect("key-1");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("get_metrics_summary");
    await client.close();
  });

  test("calls Mailgun with each request's own key", async () => {
    const [first, second] = await Promise.all([connect("key-first"), connect("key-second")]);
    await Promise.all([
      first.callTool({ name: "get-v4-domains", arguments: {} }),
      second.callTool({ name: "get-v4-domains", arguments: {} }),
    ]);
    expect(makeMailgunRequest).toHaveBeenCalledTimes(2);
    for (const apiKey of ["key-first", "key-second"]) {
      expect(makeMailgunRequest).toHaveBeenCalledWith(
        { apiKey, hostname: HOSTNAME },
        "GET",
        "/v4/domains",
        null,
        expect.any(String),
      );
    }
    await Promise.all([first.close(), second.close()]);
  });
});
