export const KNOWN_TAGS = ["send", "validate", "optimize", "inspect"] as const;

export type Tag = (typeof KNOWN_TAGS)[number];

export const META_TAGS_KEY = "com.mailgun/tags";

export type ActiveTags = ReadonlySet<Tag> | "all";

const KNOWN_TAG_SET: ReadonlySet<string> = new Set<string>(KNOWN_TAGS);

export function isKnownTag(value: string): value is Tag {
  return KNOWN_TAG_SET.has(value);
}

export interface ParseTagListResult {
  tags: Tag[];
  invalid: string[];
}

// Splits a comma-separated tag list into known/unknown buckets.
// Trims whitespace, lowercases, drops empty entries, and dedupes while preserving first-occurrence order.
export function parseTagList(raw: string): ParseTagListResult {
  const tags: Tag[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const segment of raw.split(",")) {
    const trimmed = segment.trim().toLowerCase();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (isKnownTag(trimmed)) {
      tags.push(trimmed);
    } else {
      invalid.push(trimmed);
    }
  }
  return { tags, invalid };
}

export function shouldRegister(active: ActiveTags, entryTags: readonly Tag[]): boolean {
  if (active === "all") return true;
  if (entryTags.length === 0) return false;
  for (const tag of entryTags) {
    if (active.has(tag)) return true;
  }
  return false;
}
