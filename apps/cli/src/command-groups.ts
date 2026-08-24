/**
 * The top-level `bb` command groups and the rule for which of them one
 * invocation needs. Every entry is loaded with `import()` so the module that
 * registers it — and everything it pulls in (zod schemas, the SDK, plugin
 * build tooling, scaffold templates) — stays out of the startup graph until a
 * command actually asks for it; the build splits chunks along these
 * `import()` boundaries. This file must therefore contain no value imports: a
 * single static one would pull the whole subtree into the entry chunk and
 * every `bb` invocation would pay for it again.
 */
import type { Command } from "commander";
import type { ContextSnapshot } from "./context-env.js";

export interface CommandGroupDeps {
  getUrl(): string;
  getContext(): ContextSnapshot;
}

export type CommandGroupRegistrar = (
  program: Command,
  deps: CommandGroupDeps,
) => void;

export interface CommandGroup {
  /** The top-level name commander resolves, e.g. `thread` in `bb thread`. */
  readonly name: string;
  readonly load: () => Promise<CommandGroupRegistrar>;
}

function group<Module>(
  name: string,
  load: () => Promise<Module>,
  register: (module: Module) => CommandGroupRegistrar,
): CommandGroup {
  return { name, load: () => load().then(register) };
}

/**
 * In `bb --help` order: commander lists subcommands in registration order,
 * so this array is the help output's order.
 */
export const CORE_COMMAND_GROUPS: readonly CommandGroup[] = [
  group(
    "status",
    () => import("./commands/status.js"),
    (m) => (program, deps) =>
      m.registerStatusCommand(program, deps.getUrl, deps.getContext),
  ),
  group(
    "settings",
    () => import("./commands/settings.js"),
    (m) => (program, deps) => m.registerSettingsCommands(program, deps.getUrl),
  ),
  group(
    "project",
    () => import("./commands/project.js"),
    (m) => (program, deps) => m.registerProjectCommands(program, deps.getUrl),
  ),
  group(
    "provider",
    () => import("./commands/provider.js"),
    (m) => (program, deps) => m.registerProviderCommands(program, deps.getUrl),
  ),
  group(
    "manager",
    () => import("./commands/manager.js"),
    (m) => (program) => m.registerManagerCommands(program),
  ),
  group(
    "machine",
    () => import("./commands/machine.js"),
    (m) => (program, deps) => m.registerMachineCommands(program, deps.getUrl),
  ),
  group(
    "updates",
    () => import("./commands/updates.js"),
    (m) => (program, deps) => m.registerUpdatesCommands(program, deps.getUrl),
  ),
  group(
    "terminal",
    () => import("./commands/terminal.js"),
    (m) => (program, deps) => m.registerTerminalCommands(program, deps.getUrl),
  ),
  group(
    "thread",
    () => import("./commands/thread/index.js"),
    (m) => (program, deps) => m.registerThreadCommands(program, deps.getUrl),
  ),
  group(
    "environment",
    () => import("./commands/environment.js"),
    (m) => (program, deps) =>
      m.registerEnvironmentCommands(program, deps.getUrl),
  ),
  group(
    "file",
    () => import("./commands/file.js"),
    (m) => (program, deps) => m.registerFileCommands(program, deps.getUrl),
  ),
  group(
    "theme",
    () => import("./commands/theme.js"),
    (m) => (program, deps) => m.registerThemeCommands(program, deps.getUrl),
  ),
  group(
    "plugin",
    () => import("./commands/plugin.js"),
    (m) => (program, deps) => m.registerPluginCommands(program, deps.getUrl),
  ),
  group(
    "marketplace",
    () => import("./commands/marketplace.js"),
    (m) => (program, deps) =>
      m.registerMarketplaceCommands(program, deps.getUrl),
  ),
  group(
    "skill",
    () => import("./commands/skill.js"),
    (m) => (program, deps) =>
      m.registerSkillCommands(program, deps.getUrl, deps.getContext),
  ),
  group(
    "guide",
    () => import("./commands/guide.js"),
    (m) => (program) => m.registerGuideCommand(program),
  ),
  group(
    "voice",
    () => import("./commands/voice.js"),
    (m) => (program, deps) => m.registerVoiceCommands(program, deps.getUrl),
  ),
];

/**
 * The groups one invocation must register before commander parses it.
 * `--version` needs none: commander answers it from the program alone. A
 * first token that names a core group needs only that group. Anything else
 * — no arguments, `help`, `--help`, an unknown or plugin-contributed name —
 * needs all of them so help output and "unknown command" suggestions match
 * what a fully registered program would print.
 */
export function selectCommandGroups(
  firstArg: string | undefined,
): readonly CommandGroup[] {
  if (firstArg === "--version" || firstArg === "-V") return [];
  const match = CORE_COMMAND_GROUPS.find((entry) => entry.name === firstArg);
  return match === undefined ? CORE_COMMAND_GROUPS : [match];
}

/**
 * The first CLI token is a plugin-proxy candidate only when it looks like a
 * command (not a flag) and no core command claims it. Core commands always
 * win: commander resolved them before this path runs.
 */
export function pluginProxyCandidate(
  firstArg: string | undefined,
  knownCommandNames: ReadonlySet<string>,
): string | null {
  if (firstArg === undefined || firstArg.length === 0) return null;
  if (firstArg.startsWith("-")) return null;
  if (knownCommandNames.has(firstArg)) return null;
  return firstArg;
}
