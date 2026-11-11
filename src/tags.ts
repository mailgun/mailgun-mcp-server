export const KNOWN_TAGS = ["send", "validate", "optimize", "inspect"] as const;

export type Tag = (typeof KNOWN_TAGS)[number];

export const META_TAGS_KEY = "com.mailgun/tags";
export const META_TOOLSET_KEY = "com.mailgun/toolset";

// Descriptions are shown to the model by the toolset meta-tools and in --list-tags.
export const TOOLSETS = {
  "send.messages": "Send email; retrieve and resend stored messages",
  "send.domains": "Domains: details, DNS verification, sending queues, tracking settings",
  "send.webhooks": "Domain webhooks: list, view, create, update",
  "send.account": "Account IPs, dedicated IP pools, and custom sending limits",
  "send.message_tags":
    "Message tags: list tags, stats by tag, tag limits, devices/providers/countries",
  "send.analytics":
    "Sending stats and aggregates, analytics metrics and logs, bounce classification, metrics summary",
  "send.suppressions": "Suppression lists: bounces, unsubscribes, complaints, allowlist",
  "send.routes": "Inbound routes: list, view, update",
  "send.lists": "Mailing lists and list members",
  "send.templates": "Templates and template versions",
  validate: "Email address validation",
  optimize: "Inbox placement test results",
  inspect: "Email preview QA: run and resume tests, client renders, check results",
} as const;

export type ToolsetId = keyof typeof TOOLSETS;

export const TOOLSET_IDS = Object.keys(TOOLSETS) as [ToolsetId, ...ToolsetId[]];

// Values accepted by --tags / MAILGUN_MCP_TAGS.
export type TagSelector = Tag | ToolsetId | "core" | "dynamic" | "all";

export const KNOWN_TAG_SELECTORS: readonly TagSelector[] = [
  "all",
  "dynamic",
  "core",
  ...new Set<TagSelector>([...KNOWN_TAGS, ...TOOLSET_IDS]),
];

// "dynamic": core tools, more on demand. "all" (the default) or a set: a fixed tool list.
export type ActiveTags = "dynamic" | "all" | ReadonlySet<TagSelector>;

export interface ToolClassification {
  tags: readonly Tag[];
  toolset: ToolsetId;
  core: boolean;
  readOnly: boolean;
}

const KNOWN_TAG_SET: ReadonlySet<string> = new Set<string>(KNOWN_TAGS);
const KNOWN_TAG_SELECTOR_SET: ReadonlySet<string> = new Set<string>(KNOWN_TAG_SELECTORS);

export function isKnownTag(value: string): value is Tag {
  return KNOWN_TAG_SET.has(value);
}

export function isKnownTagSelector(value: string): value is TagSelector {
  return KNOWN_TAG_SELECTOR_SET.has(value);
}

export function toolsetTag(toolset: ToolsetId): Tag {
  return toolset.split(".")[0] as Tag;
}

export function toolConfig(classification: ToolClassification): {
  annotations: { readOnlyHint: boolean };
  _meta: Record<string, unknown>;
} {
  return {
    annotations: { readOnlyHint: classification.readOnly },
    _meta: {
      [META_TAGS_KEY]: [...classification.tags],
      [META_TOOLSET_KEY]: classification.toolset,
    },
  };
}

export interface ParseTagListResult {
  tags: TagSelector[];
  invalid: string[];
}

// Splits a comma-separated tag list into known/unknown buckets.
// Trims whitespace, lowercases, drops empty entries, and dedupes while preserving first-occurrence order.
export function parseTagList(raw: string): ParseTagListResult {
  const tags: TagSelector[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const segment of raw.split(",")) {
    const trimmed = segment.trim().toLowerCase();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (isKnownTagSelector(trimmed)) {
      tags.push(trimmed);
    } else {
      invalid.push(trimmed);
    }
  }
  return { tags, invalid };
}

// Dynamic mode registers every tool; ToolLoader decides which ones load.
export function shouldRegister(active: ActiveTags, tool: ToolClassification): boolean {
  if (active === "dynamic" || active === "all") return true;
  for (const selector of active) {
    if (selector === "core") {
      if (tool.core) return true;
    } else if (isKnownTag(selector)) {
      if (tool.tags.includes(selector)) return true;
    } else if (tool.toolset === selector) {
      return true;
    }
  }
  return false;
}
