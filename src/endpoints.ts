import { type Tag, type ToolClassification, type ToolsetId, toolsetTag } from "./tags.js";

export type EndpointEntry =
  | string
  | {
      endpoint: string;
      toolName?: string;
      tags?: readonly Tag[];
      core?: boolean;
      readOnly?: boolean;
    };

export interface ToolsetEndpoint {
  toolset: ToolsetId;
  entry: EndpointEntry;
}

export interface ParsedEndpointEntry extends ToolClassification {
  method: string;
  path: string;
  toolNameOverride?: string;
}

function toSpec(entry: EndpointEntry): Exclude<EndpointEntry, string> {
  return typeof entry === "string" ? { endpoint: entry } : entry;
}

export function endpointLabel({ entry }: ToolsetEndpoint): string {
  return toSpec(entry).endpoint;
}

export function parseEndpointEntry({ toolset, entry }: ToolsetEndpoint): ParsedEndpointEntry {
  const spec = toSpec(entry);
  const [method, path] = spec.endpoint.split(" ");
  return {
    method,
    path,
    toolNameOverride: spec.toolName,
    tags: spec.tags && spec.tags.length > 0 ? spec.tags : [toolsetTag(toolset)],
    toolset,
    core: spec.core ?? false,
    readOnly: spec.readOnly ?? method.toUpperCase() === "GET",
  };
}

// Endpoints are grouped by toolset. Plain strings take their tag from the toolset and are
// read-only when they are GET requests. Object form can be used to set a tool name, mark a
// tool as `core` (loaded at startup in dynamic mode), or mark a non-GET query as `readOnly`.
// Example:
// {
//   endpoint: "POST /v3/{domain_name}/some-query",
//   toolName: "some_query",
//   readOnly: true,
// }
export const endpointGroups: Readonly<Record<ToolsetId, readonly EndpointEntry[]>> = {
  "send.messages": [
    { endpoint: "POST /v3/{domain_name}/messages", core: true },
    "GET /v3/domains/{domain_name}/messages/{storage_key}",
    "POST /v3/domains/{domain_name}/messages/{storage_key}",
  ],

  "send.domains": [
    // Domains
    { endpoint: "GET /v4/domains", core: true },
    { endpoint: "GET /v4/domains/{name}", core: true },
    { endpoint: "PUT /v4/domains/{name}/verify", core: true },
    "GET /v3/domains/{name}/sending_queues",

    // Domain Tracking
    { endpoint: "GET /v3/domains/{name}/tracking", core: true },
    "PUT /v3/domains/{name}/tracking/click",
    "PUT /v3/domains/{name}/tracking/open",
    "PUT /v3/domains/{name}/tracking/unsubscribe",
  ],

  "send.webhooks": [
    "GET /v3/domains/{domain}/webhooks",
    "POST /v3/domains/{domain}/webhooks",
    "GET /v3/domains/{domain_name}/webhooks/{webhook_name}",
    "PUT /v3/domains/{domain_name}/webhooks/{webhook_name}",
  ],

  "send.account": [
    // IPs & IP Pools
    "GET /v5/accounts/subaccounts/ip_pools/all",
    "GET /v3/ips",
    "GET /v3/ips/{ip}",
    "GET /v3/ips/{ip}/domains",
    "GET /v3/ip_pools",
    "GET /v3/ip_pools/{pool_id}",
    "GET /v3/ip_pools/{pool_id}/domains",

    // Account Limits
    "GET /v5/accounts/limit/custom/monthly",
  ],

  "send.message_tags": [
    "GET /v3/{domain}/tags",
    "GET /v3/{domain}/tag",
    "GET /v3/{domain}/tag/stats/aggregates",
    "GET /v3/{domain}/tag/stats",
    "GET /v3/domains/{domain}/tag/devices",
    "GET /v3/domains/{domain}/tag/providers",
    "GET /v3/domains/{domain}/tag/countries",
    "GET /v3/domains/{domain}/limits/tag",
  ],

  "send.analytics": [
    // Stats & Aggregates
    "GET /v3/stats/total",
    "GET /v3/{domain}/stats/total",
    "GET /v3/stats/total/domains",
    "GET /v3/stats/filter",
    "GET /v3/{domain}/aggregates/providers",
    "GET /v3/{domain}/aggregates/devices",
    "GET /v3/{domain}/aggregates/countries",

    // Analytics
    { endpoint: "POST /v1/analytics/metrics", core: true, readOnly: true },
    { endpoint: "POST /v1/analytics/usage/metrics", readOnly: true },
    { endpoint: "POST /v1/analytics/logs", core: true, readOnly: true },

    // Bounce Classification
    { endpoint: "POST /v2/bounce-classification/metrics", core: true, readOnly: true },
  ],

  "send.suppressions": [
    // Bounces
    { endpoint: "GET /v3/{domain_name}/bounces/{address}", core: true },
    { endpoint: "GET /v3/{domain_name}/bounces", core: true },

    // Unsubscribes
    "GET /v3/{domain_name}/unsubscribes/{address}",
    { endpoint: "GET /v3/{domain_name}/unsubscribes", core: true },

    // Complaints
    "GET /v3/{domain_name}/complaints/{address}",
    { endpoint: "GET /v3/{domain_name}/complaints", core: true },

    // Allowlist
    "GET /v3/{domain_name}/whitelists/{value}",
    "GET /v3/{domain_name}/whitelists",
  ],

  "send.routes": ["GET /v3/routes", "GET /v3/routes/{id}", "PUT /v3/routes/{id}"],

  "send.lists": [
    "GET /v3/lists",
    "POST /v3/lists",
    "GET /v3/lists/{list_address}",
    "PUT /v3/lists/{list_address}",
    "GET /v3/lists/{list_address}/members",
    "POST /v3/lists/{list_address}/members",
    "GET /v3/lists/{list_address}/members/{member_address}",
    "PUT /v3/lists/{list_address}/members/{member_address}",
  ],

  "send.templates": [
    { endpoint: "GET /v3/{domain_name}/templates", core: true },
    "POST /v3/{domain_name}/templates",
    "GET /v3/{domain_name}/templates/{template_name}",
    "PUT /v3/{domain_name}/templates/{template_name}",
    "GET /v3/{domain_name}/templates/{template_name}/versions",
    "POST /v3/{domain_name}/templates/{template_name}/versions",
    "GET /v3/{domain_name}/templates/{template_name}/versions/{version_name}",
    "PUT /v3/{domain_name}/templates/{template_name}/versions/{version_name}",
  ],

  validate: [
    {
      endpoint: "GET /v4/address/validate",
      toolName: "validate_email",
      tags: ["validate"],
      core: true,
    },
  ],

  optimize: [
    {
      endpoint: "GET /v4/inbox/results/{result}",
      toolName: "get_inbox_placement_result",
      tags: ["optimize"],
    },
  ],

  inspect: [
    {
      endpoint: "GET /v1/preview/tests/{test_id}/results",
      toolName: "get_preview_result",
      tags: ["inspect"],
    },
  ],
};

export const endpoints: readonly ToolsetEndpoint[] = (
  Object.keys(endpointGroups) as ToolsetId[]
).flatMap((toolset) => endpointGroups[toolset].map((entry) => ({ toolset, entry })));
