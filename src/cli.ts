import {
  type ActiveTags,
  KNOWN_TAG_SELECTORS,
  KNOWN_TAGS,
  parseTagList,
  TOOLSET_IDS,
  TOOLSETS,
} from "./tags.js";

export interface CliResult {
  activeTags: ActiveTags;
  showHelp: boolean;
  listTags: boolean;
  invalid: string[];
  error?: string;
}

const TAGS_ENV_VAR = "MAILGUN_MCP_TAGS";

interface ParsedArgv {
  showHelp: boolean;
  listTags: boolean;
  cliTagsRaw: string | undefined;
}

function parseArgv(argv: readonly string[]): ParsedArgv {
  let showHelp = false;
  let listTags = false;
  let cliTagsRaw: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }

    if (arg === "--list-tags") {
      listTags = true;
      continue;
    }

    if (arg === "--tags") {
      const next = argv[i + 1];
      if (next !== undefined) {
        cliTagsRaw = next;
        i += 1;
      }
      continue;
    }

    if (arg.startsWith("--tags=")) {
      cliTagsRaw = arg.slice("--tags=".length);
      continue;
    }
  }

  return { showHelp, listTags, cliTagsRaw };
}

export function resolveActiveTags(argv: readonly string[], env: NodeJS.ProcessEnv): CliResult {
  const { showHelp, listTags, cliTagsRaw } = parseArgv(argv);

  // CLI takes precedence over env. An unset, empty, or whitespace-only value is
  // treated as "no filter specified" (activeTags === "all").
  const rawSource = cliTagsRaw !== undefined ? cliTagsRaw : env[TAGS_ENV_VAR];

  if (rawSource === undefined || rawSource.trim() === "") {
    return { activeTags: "all", showHelp, listTags, invalid: [] };
  }

  const { tags, invalid } = parseTagList(rawSource);

  if (invalid.length > 0) {
    return { activeTags: "all", showHelp, listTags, invalid };
  }

  // Input was non-empty but contained only separators/whitespace.
  // Treat the same as an empty value.
  if (tags.length === 0) {
    return { activeTags: "all", showHelp, listTags, invalid: [] };
  }

  if (tags.includes("dynamic") && tags.length > 1) {
    return {
      activeTags: "all",
      showHelp,
      listTags,
      invalid: [],
      error: `"dynamic" can't be combined with other --tags / ${TAGS_ENV_VAR} values (got "${tags.join(",")}"). Use dynamic on its own, or list only the tags or toolsets to load.`,
    };
  }

  if (tags.includes("all")) {
    return { activeTags: "all", showHelp, listTags, invalid: [] };
  }

  if (tags.includes("dynamic")) {
    return { activeTags: "dynamic", showHelp, listTags, invalid: [] };
  }

  return {
    activeTags: new Set(tags),
    showHelp,
    listTags,
    invalid: [],
  };
}

export function formatTagList(): string {
  const toolsetIds: readonly string[] = TOOLSET_IDS;
  const rows: [string, string][] = [
    ["all", "Every tool, loaded at startup (default)"],
    ["dynamic", "Core tools at startup; the model loads other toolsets on demand"],
    ["core", "Only the core tools"],
    ...KNOWN_TAGS.filter((tag) => !toolsetIds.includes(tag)).map((tag): [string, string] => [
      tag,
      `Every ${tag}.* toolset`,
    ]),
    ...TOOLSET_IDS.map((id): [string, string] => [id, TOOLSETS[id]]),
  ];
  const width = Math.max(...rows.map(([name]) => name.length)) + 2;
  return rows.map(([name, description]) => `${name.padEnd(width)}${description}`).join("\n");
}

export function formatHelp(): string {
  const tagList = KNOWN_TAGS.join(", ");
  return [
    "Usage: mailgun-mcp-server [options]",
    "",
    "Options:",
    "  --tags <list>      Comma-separated tags or toolsets to load (default: all).",
    `                     Tags: ${tagList}.`,
    "                     Also: send.<group> toolsets, core, all, and dynamic (see --list-tags).",
    "                     dynamic: start with core tools; the model loads more on demand.",
    "  --list-tags        Print valid --tags values with descriptions and exit",
    "  --help, -h         Show this help and exit",
    "",
    "Environment:",
    "  MAILGUN_API_KEY        (required) Mailgun API key",
    "  MAILGUN_API_REGION     'us' (default) or 'eu'",
    "  MAILGUN_API_HOSTNAME   Override API hostname",
    `  ${TAGS_ENV_VAR}       Same as --tags. CLI flag takes precedence.`,
    "",
    "Examples:",
    "  MAILGUN_API_KEY=... mailgun-mcp-server",
    "  MAILGUN_API_KEY=... mailgun-mcp-server --tags dynamic",
    "  MAILGUN_API_KEY=... mailgun-mcp-server --tags validate,inspect",
    "  MAILGUN_API_KEY=... mailgun-mcp-server --tags core,send.templates",
  ].join("\n");
}

export function formatInvalidTagsMessage(invalid: readonly string[]): string {
  const list = KNOWN_TAG_SELECTORS.join(", ");
  const plural = invalid.length === 1 ? "tag" : "tags";
  return `Unknown ${plural}: ${invalid.join(", ")}. Valid values: ${list}. Run with --list-tags for descriptions.`;
}
