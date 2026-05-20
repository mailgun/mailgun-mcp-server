import { type ActiveTags, KNOWN_TAGS, parseTagList } from "./tags.js";

export interface CliResult {
  activeTags: ActiveTags;
  showHelp: boolean;
  listTags: boolean;
  invalid: string[];
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

  return {
    activeTags: new Set(tags),
    showHelp,
    listTags,
    invalid: [],
  };
}

export function formatTagList(): string {
  return KNOWN_TAGS.join("\n");
}

export function formatHelp(): string {
  const tagList = KNOWN_TAGS.join(", ");
  return [
    "Usage: mailgun-mcp-server [options]",
    "",
    "Options:",
    `  --tags <list>      Comma-separated product tags to enable (default: all).`,
    `                     Valid: ${tagList}`,
    "  --list-tags        Print valid tag values and exit",
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
    "  MAILGUN_API_KEY=... mailgun-mcp-server --tags validate,inspect",
  ].join("\n");
}

export function formatInvalidTagsMessage(invalid: readonly string[]): string {
  const list = KNOWN_TAGS.join(", ");
  const plural = invalid.length === 1 ? "tag" : "tags";
  return `Unknown ${plural}: ${invalid.join(", ")}. Valid tags: ${list}.`;
}
