import type { Tag } from "./tags.js";

export type EndpointEntry = string | { endpoint: string; toolName?: string; tags?: readonly Tag[] };

export interface ParsedEndpointEntry {
  method: string;
  path: string;
  toolNameOverride?: string;
  // Always non-empty. Defaults to ["send"] when an entry omits an explicit `tags`
  // Promote an entry to the object form to override.
  tags: readonly Tag[];
}

const DEFAULT_TAGS: readonly Tag[] = ["send"];

export function parseEndpointEntry(entry: EndpointEntry): ParsedEndpointEntry {
  if (typeof entry === "string") {
    const [method, path] = entry.split(" ");
    return { method, path, tags: DEFAULT_TAGS };
  }

  const [method, path] = entry.endpoint.split(" ");
  return {
    method,
    path,
    toolNameOverride: entry.toolName,
    tags: entry.tags && entry.tags.length > 0 ? entry.tags : DEFAULT_TAGS,
  };
}

export const endpoints: readonly EndpointEntry[] = [
  // Messages
  "POST /v3/{domain_name}/messages",
  "GET /v3/domains/{domain_name}/messages/{storage_key}",
  "POST /v3/domains/{domain_name}/messages/{storage_key}",

  // Domains
  "GET /v4/domains",
  "GET /v4/domains/{name}",
  "PUT /v4/domains/{name}/verify",
  "GET /v3/domains/{name}/sending_queues",

  // Domain Tracking
  "GET /v3/domains/{name}/tracking",
  "PUT /v3/domains/{name}/tracking/click",
  "PUT /v3/domains/{name}/tracking/open",
  "PUT /v3/domains/{name}/tracking/unsubscribe",

  // Webhooks
  "GET /v3/domains/{domain}/webhooks",
  "POST /v3/domains/{domain}/webhooks",
  "GET /v3/domains/{domain_name}/webhooks/{webhook_name}",
  "PUT /v3/domains/{domain_name}/webhooks/{webhook_name}",

  // IPs & IP Pools
  "GET /v5/accounts/subaccounts/ip_pools/all",
  "GET /v3/ips",
  "GET /v3/ips/{ip}",
  "GET /v3/ips/{ip}/domains",
  "GET /v3/ip_pools",
  "GET /v3/ip_pools/{pool_id}",
  "GET /v3/ip_pools/{pool_id}/domains",

  // Tags
  "GET /v3/{domain}/tags",
  "GET /v3/{domain}/tag",
  "GET /v3/{domain}/tag/stats/aggregates",
  "GET /v3/{domain}/tag/stats",
  "GET /v3/domains/{domain}/tag/devices",
  "GET /v3/domains/{domain}/tag/providers",
  "GET /v3/domains/{domain}/tag/countries",
  "GET /v3/domains/{domain}/limits/tag",

  // Stats & Aggregates
  "GET /v3/stats/total",
  "GET /v3/{domain}/stats/total",
  "GET /v3/stats/total/domains",
  "GET /v3/stats/filter",
  "GET /v3/{domain}/aggregates/providers",
  "GET /v3/{domain}/aggregates/devices",
  "GET /v3/{domain}/aggregates/countries",

  // Analytics
  "POST /v1/analytics/metrics",
  "POST /v1/analytics/usage/metrics",
  "POST /v1/analytics/logs",

  // Suppressions - Bounces
  "GET /v3/{domain_name}/bounces/{address}",
  "GET /v3/{domain_name}/bounces",

  // Suppressions - Unsubscribes
  "GET /v3/{domain_name}/unsubscribes/{address}",
  "GET /v3/{domain_name}/unsubscribes",

  // Suppressions - Complaints
  "GET /v3/{domain_name}/complaints/{address}",
  "GET /v3/{domain_name}/complaints",

  // Suppressions - Allowlist
  "GET /v3/{domain_name}/whitelists/{value}",
  "GET /v3/{domain_name}/whitelists",

  // Routes
  "GET /v3/routes",
  "GET /v3/routes/{id}",
  "PUT /v3/routes/{id}",

  // Mailing Lists
  "GET /v3/lists",
  "POST /v3/lists",
  "GET /v3/lists/{list_address}",
  "PUT /v3/lists/{list_address}",
  "GET /v3/lists/{list_address}/members",
  "POST /v3/lists/{list_address}/members",
  "GET /v3/lists/{list_address}/members/{member_address}",
  "PUT /v3/lists/{list_address}/members/{member_address}",

  // Templates
  "GET /v3/{domain_name}/templates",
  "POST /v3/{domain_name}/templates",
  "GET /v3/{domain_name}/templates/{template_name}",
  "PUT /v3/{domain_name}/templates/{template_name}",
  "GET /v3/{domain_name}/templates/{template_name}/versions",
  "POST /v3/{domain_name}/templates/{template_name}/versions",
  "GET /v3/{domain_name}/templates/{template_name}/versions/{version_name}",
  "PUT /v3/{domain_name}/templates/{template_name}/versions/{version_name}",

  // Bounce Classification
  "GET /v1/bounce-classification/stats",
  "POST /v2/bounce-classification/metrics",

  // Account Limits
  "GET /v5/accounts/limit/custom/monthly",

  // Validation
  { endpoint: "GET /v4/address/validate", toolName: "validate_email", tags: ["validate"] },

  // Inbox Placement (Optimize)
  {
    endpoint: "GET /v4/inbox/results/{result}",
    toolName: "get_inbox_placement_result",
    tags: ["optimize"],
  },

  // Email Preview (Inspect)
  {
    endpoint: "GET /v1/preview/tests/{test_id}/results",
    toolName: "get_preview_result",
    tags: ["inspect"],
  },
] as const;
