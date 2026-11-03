export type McpToolMode = "read" | "write";

export const MAX_CLI_ARGUMENTS = 64;
export const MAX_CLI_ARGUMENT_CHARS = 200_000;

export const READ_ONLY_COMMAND_PATHS: ReadonlySet<string> = new Set([
  "status",
  "guide",
  "settings show",
  "settings version",
  "settings keyboard list",
  "settings ui list",
  "settings ui get",
  "settings ai-services show",
  "project list",
  "project show",
  "project history",
  "project paths",
  "project commands",
  "project files",
  "project content",
  "prompt-history list",
  "provider list",
  "provider models",
  "machine list",
  "machine show",
  "machine providers",
  "machine provider-cli status",
  "machine env list",
  "updates status",
  "terminal list",
  "terminal show",
  "terminal output",
  "thread list",
  "thread show",
  "thread log",
  "thread output",
  "thread search",
  "thread history",
  "thread count",
  "thread context",
  "thread commands",
  "thread wait",
  "thread queue list",
  "thread tabs show",
  "thread section list",
  "thread interactions list",
  "thread interactions show",
  "environment list",
  "environment show",
  "environment status",
  "environment paths",
  "environment diff",
  "environment diff-files",
  "environment diff-file",
  "environment diff-patch",
  "environment providers",
  "pull-request show",
  "file read",
  "file list",
  "file paths",
  "theme list",
  "theme show",
  "plugin list",
  "plugin search",
  "plugin install-jobs",
  "plugin update-jobs",
  "plugin rpc list",
  "plugin rpc inspect",
  "marketplace list",
  "skill list",
  "skill show",
  "skill files",
  "skill search",
  "skill registry detail",
  "skill cli-skills-status",
]);

export const READ_ONLY_BUNDLED_PLUGIN_COMMAND_PATHS: ReadonlySet<string> =
  new Set([
    "git status",
    "git branches",
    "git diff",
    "git files",
    "git file",
    "git patch",
    "git viewed list",
  ]);

const UNAVAILABLE_COMMAND_PREFIXES: readonly (readonly string[])[] = [
  ["terminal", "attach"],
  ["plugin", "dev"],
  ["browser", "watch"],
];

const TOP_LEVEL_ALIASES: ReadonlyMap<string, string> = new Map([
  ["host", "machine"],
  ["hosts", "machine"],
  ["machines", "machine"],
  ["env", "environment"],
  ["envs", "environment"],
  ["environments", "environment"],
  ["threads", "thread"],
  ["projects", "project"],
  ["terminals", "terminal"],
  ["providers", "provider"],
  ["plugins", "plugin"],
  ["skills", "skill"],
]);

export type CliAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

function deny(reason: string): CliAccessDecision {
  return { allowed: false, reason };
}

function leadingWords(argv: readonly string[]): string[] {
  const words: string[] = [];
  for (const argument of argv) {
    if (argument.startsWith("-")) break;
    words.push(argument);
  }
  return words;
}

function longestKnownPath(
  words: readonly string[],
  knownPaths: ReadonlySet<string>,
): string | null {
  for (let length = words.length; length > 0; length -= 1) {
    const candidate = words.slice(0, length).join(" ");
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function startsWithWords(
  words: readonly string[],
  prefix: readonly string[],
): boolean {
  return prefix.every((word, index) => words[index] === word);
}

function isHelpRequest(
  argv: readonly string[],
  knownPaths: ReadonlySet<string>,
): boolean {
  const last = argv.at(-1);
  if (last !== "--help" && last !== "-h") return false;
  const words = argv.slice(0, -1);
  if (words.length === 0) return true;
  const path = words.join(" ");
  if (knownPaths.has(path)) return true;
  for (const known of knownPaths) {
    if (known.startsWith(`${path} `)) return true;
  }
  return false;
}

export function evaluateCliAccess(
  argv: readonly string[],
  mode: McpToolMode,
  knownPaths: ReadonlySet<string>,
): CliAccessDecision {
  if (argv.length === 0) return deny("Pass at least one argument.");
  if (argv.length > MAX_CLI_ARGUMENTS) {
    return deny(`Pass at most ${MAX_CLI_ARGUMENTS} arguments.`);
  }
  let totalChars = 0;
  for (const argument of argv) {
    if (argument.includes("\0")) {
      return deny("Arguments must not contain NUL bytes.");
    }
    totalChars += argument.length;
  }
  if (totalChars > MAX_CLI_ARGUMENT_CHARS) {
    return deny("The arguments are too long; pass long text through stdin.");
  }

  const words = leadingWords(argv);
  const canonicalFirst =
    words[0] === undefined
      ? undefined
      : (TOP_LEVEL_ALIASES.get(words[0]) ?? words[0]);
  const canonicalWords =
    canonicalFirst === undefined ? [] : [canonicalFirst, ...words.slice(1)];
  for (const prefix of UNAVAILABLE_COMMAND_PREFIXES) {
    if (startsWithWords(canonicalWords, prefix)) {
      return deny(
        `\`bb ${prefix.join(" ")}\` cannot run over MCP: it needs an interactive terminal or never exits. Run it in a terminal on the machine.`,
      );
    }
  }

  if (mode === "write") return { allowed: true };

  if (argv.length === 1 && argv[0] === "--version") return { allowed: true };
  const readablePaths = new Set([
    ...knownPaths,
    ...READ_ONLY_BUNDLED_PLUGIN_COMMAND_PATHS,
  ]);
  if (isHelpRequest(argv, readablePaths)) return { allowed: true };
  const path = longestKnownPath(words, readablePaths);
  if (
    path !== null &&
    (READ_ONLY_COMMAND_PATHS.has(path) ||
      READ_ONLY_BUNDLED_PLUGIN_COMMAND_PATHS.has(path))
  ) {
    return { allowed: true };
  }
  const shown = path ?? words.slice(0, 3).join(" ");
  return deny(
    `\`bb ${shown}\` is not on the read-only list. The \`read\` tool accepts only the canonical command names that inspect bb (no aliases, and no plugin commands except the bundled Git plugin's reads). Use the \`run\` tool for anything else.`,
  );
}
