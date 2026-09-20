import type { Command, Option } from "commander";

export interface ResolvedInvocation {
  command: Command;
  path: string[];
  unknownSubcommand: string | null;
}

export const TOP_LEVEL_SOFT_ALIASES: Readonly<Record<string, string>> = {
  host: "machine",
  hosts: "machine",
  machines: "machine",
  env: "environment",
  envs: "environment",
  environments: "environment",
  providers: "provider",
  plugins: "plugin",
  threads: "thread",
  projects: "project",
  terminals: "terminal",
  skills: "skill",
};

const TOP_LEVEL_SUGGESTIONS: Readonly<Record<string, string>> = {
  ...TOP_LEVEL_SOFT_ALIASES,
  model: "provider models",
  models: "provider models",
  agent: "provider list",
  agents: "provider list",
  section: "thread section",
  sections: "thread section",
  doctor: "diagnostics",
  config: "settings",
  logs: "thread log",
};

const SUBCOMMAND_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  get: ["show"],
  view: ["show"],
  info: ["show"],
  describe: ["show"],
  inspect: ["show"],
  status: ["show", "list"],
  ls: ["list"],
  all: ["list"],
  message: ["tell"],
  msg: ["tell"],
  say: ["tell"],
  send: ["tell", "send"],
  messages: ["log"],
  timeline: ["log"],
  events: ["log"],
  transcript: ["log"],
  logs: ["log", "logs", "output"],
  create: ["spawn", "new", "add"],
  new: ["spawn", "create"],
  start: ["spawn", "create"],
  add: ["create", "install", "spawn"],
  rm: ["remove", "delete"],
  delete: ["remove"],
  remove: ["delete"],
  uninstall: ["remove"],
  destroy: ["delete", "remove"],
  read: ["output", "show"],
  tail: ["output", "log"],
  cat: ["output", "read"],
  restart: ["reload"],
  refresh: ["reload"],
  edit: ["update"],
  set: ["update"],
  kill: ["stop", "close"],
  find: ["search", "list"],
};

const OPTION_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  "--reasoning": ["--reasoning-level"],
  "--effort": ["--reasoning-level"],
  "--tail": ["--tail-bytes", "--lines", "--limit"],
  "--lines": ["--tail-bytes", "--lines", "--limit"],
  "--pattern": ["--regex", "--contains"],
  "--match": ["--regex", "--contains"],
  "--parent": ["--parent-thread"],
  "--machine": ["--host"],
  "--host": ["--machine"],
  "--message": ["--prompt", "--text"],
  "--text": ["--prompt"],
  "--force": ["--yes"],
  "--format": ["--json"],
  "--include-archived": ["--archived"],
  "--from-start": ["--since-seq"],
  "--timeout-ms": ["--timeout"],
  "--status": ["--exit"],
  "--file": ["--prompt-file", "--message-file"],
};

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        above + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function nearestName(
  token: string,
  candidates: readonly string[],
): string | null {
  let best: { distance: number; name: string } | null = null;
  for (const name of candidates) {
    const distance = editDistance(token, name);
    const longest = Math.max(token.length, name.length);
    const similar = distance <= 2 && (longest - distance) / longest > 0.4;
    if (similar && (best === null || distance < best.distance)) {
      best = { distance, name };
    }
  }
  return best === null ? null : best.name;
}

function isPureGroup(command: Command): boolean {
  return (
    command.commands.length > 0 && command.registeredArguments.length === 0
  );
}

function findSubcommand(command: Command, token: string): Command | undefined {
  return command.commands.find(
    (child) => child.name() === token || child.aliases().includes(token),
  );
}

function findOption(command: Command, token: string): Option | undefined {
  const flag = token.split("=")[0];
  return command.options.find(
    (option) => option.long === flag || option.short === flag,
  );
}

export function resolveInvocation(
  program: Command,
  argv: readonly string[],
): ResolvedInvocation {
  const tokens = argv.slice(2);
  let command = program;
  const path: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") break;
    if (token.startsWith("-")) {
      const option = findOption(command, token);
      const takesValue =
        option !== undefined && (option.required || option.optional);
      if (takesValue && !token.includes("=")) index += 1;
      continue;
    }
    const child = findSubcommand(command, token);
    if (child !== undefined) {
      command = child;
      path.push(child.name());
      continue;
    }
    return {
      command,
      path,
      unknownSubcommand: isPureGroup(command) ? token : null,
    };
  }
  return { command, path, unknownSubcommand: null };
}

export function hasHelpFlag(argv: readonly string[]): boolean {
  const tokens = argv.slice(2);
  const terminator = tokens.indexOf("--");
  const scanned = terminator === -1 ? tokens : tokens.slice(0, terminator);
  return scanned.includes("--help") || scanned.includes("-h");
}

export function suggestCommand(invocation: ResolvedInvocation): string | null {
  const token = invocation.unknownSubcommand;
  if (token === null) return null;
  if (invocation.path.length === 0) {
    const target =
      TOP_LEVEL_SUGGESTIONS[token] ??
      nearestName(
        token,
        invocation.command.commands.map((child) => child.name()),
      );
    return target === null ? null : `bb ${target}`;
  }
  const candidates = SUBCOMMAND_SYNONYMS[token] ?? [];
  const match =
    candidates.find(
      (candidate) =>
        findSubcommand(invocation.command, candidate) !== undefined,
    ) ??
    nearestName(
      token,
      invocation.command.commands.map((child) => child.name()),
    );
  if (match === null) return null;
  return `bb ${[...invocation.path, match].join(" ")}`;
}

export function suggestOption(
  command: Command,
  unknownFlag: string,
): string | null {
  const flag = unknownFlag.split("=")[0];
  const longFlags = command.options
    .filter((option) => !option.hidden)
    .flatMap((option) => (option.long ? [option.long] : []));
  const synonym = (OPTION_SYNONYMS[flag] ?? []).find((candidate) =>
    longFlags.includes(candidate),
  );
  if (synonym !== undefined) return synonym;
  const prefixed = longFlags.find(
    (candidate) =>
      candidate.startsWith(`${flag}-`) || flag.startsWith(`${candidate}-`),
  );
  return prefixed ?? nearestName(flag, longFlags);
}

export function formatCommandList(command: Command): string {
  return command.commands.map((child) => child.name()).join(", ");
}

export function formatOptionList(command: Command): string {
  return command.options
    .filter((option) => !option.hidden)
    .map((option) => option.flags)
    .join(", ");
}

export function formatUsageLine(invocation: ResolvedInvocation): string {
  const prefix = ["bb", ...invocation.path].join(" ");
  return `Usage: ${prefix} ${invocation.command.usage()}`.trimEnd();
}
