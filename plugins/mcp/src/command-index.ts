import { z } from "zod";
import type { CliRunner } from "./cli-runner.js";
import { READ_ONLY_COMMAND_PATHS } from "./policy.js";

const COMMAND_INDEX_TTL_MS = 5 * 60 * 1000;
const COMMAND_INDEX_TIMEOUT_MS = 15_000;
export const SEARCH_DEFAULT_LIMIT = 12;
export const SEARCH_MAX_LIMIT = 40;

const commandSchema = z.object({
  path: z.string().min(1),
  aliases: z.array(z.string()),
  arguments: z.string(),
  description: z.string(),
  options: z.array(z.string()),
});

const commandIndexSchema = z.object({
  commands: z.array(commandSchema),
});

export type IndexedCommand = z.infer<typeof commandSchema>;

export interface CommandIndex {
  commands: readonly IndexedCommand[];
  paths: ReadonlySet<string>;
}

export interface CommandSearchMatch {
  usage: string;
  description: string;
  options: string[];
  aliases: string[];
  readOnly: boolean;
}

export class CommandIndexUnavailableError extends Error {
  constructor() {
    super(
      "The bb CLI on this bb server did not return its command index (`bb guide commands --json`), so the `read` and `search` tools are unavailable. Update bb on that machine.",
    );
    this.name = "CommandIndexUnavailableError";
  }
}

export function parseCommandIndex(stdout: string): CommandIndex {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new CommandIndexUnavailableError();
  }
  const result = commandIndexSchema.safeParse(json);
  if (!result.success) throw new CommandIndexUnavailableError();
  const parsed = result.data;
  return {
    commands: parsed.commands,
    paths: new Set(parsed.commands.map((command) => command.path)),
  };
}

export function createCommandIndexLoader(
  runCli: CliRunner,
  now: () => number = Date.now,
): () => Promise<CommandIndex> {
  let cached: { index: CommandIndex; expiresAt: number } | null = null;
  let loading: Promise<CommandIndex> | null = null;

  return async () => {
    if (cached !== null && cached.expiresAt > now()) return cached.index;
    loading ??= (async () => {
      try {
        const result = await runCli(["guide", "commands", "--json"], {
          stdin: null,
          timeoutMs: COMMAND_INDEX_TIMEOUT_MS,
          signal: new AbortController().signal,
        });
        if (result.exitCode !== 0) throw new CommandIndexUnavailableError();
        const index = parseCommandIndex(result.stdout);
        cached = { index, expiresAt: now() + COMMAND_INDEX_TTL_MS };
        return index;
      } finally {
        loading = null;
      }
    })();
    return loading;
  };
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length > 1);
}

function scoreCommand(
  command: IndexedCommand,
  terms: readonly string[],
): number {
  const path = command.path.toLowerCase();
  const pathWords = new Set(path.split(/[\s-]+/u));
  const aliases = command.aliases.join(" ").toLowerCase();
  const description = command.description.toLowerCase();
  const options = command.options.join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (pathWords.has(term)) score += 6;
    else if (path.includes(term)) score += 4;
    if (aliases.includes(term)) score += 3;
    if (description.includes(term)) score += 2;
    if (options.includes(term)) score += 1;
  }
  return score;
}

export function searchCommands(
  index: CommandIndex,
  query: string,
  limit: number,
): CommandSearchMatch[] {
  const terms = queryTerms(query);
  const ranked = index.commands
    .map((command) => ({ command, score: scoreCommand(command, terms) }))
    .filter((entry) => terms.length === 0 || entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.command.path.localeCompare(right.command.path),
    )
    .slice(0, Math.max(1, Math.min(limit, SEARCH_MAX_LIMIT)));
  return ranked.map(({ command }) => ({
    usage: `bb ${command.path}${command.arguments ? ` ${command.arguments}` : ""}`,
    description: command.description,
    options: command.options,
    aliases: command.aliases,
    readOnly: READ_ONLY_COMMAND_PATHS.has(command.path),
  }));
}
