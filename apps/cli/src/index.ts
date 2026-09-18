#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { maybeReexecViaBbCli } from "./bb-cli-reexec.js";
import {
  CORE_COMMAND_GROUPS,
  type CommandGroupDeps,
  pluginProxyCandidate,
  selectCommandGroups,
} from "./command-groups.js";
import { resolveBbCliVersion } from "./version.js";
import type { CliRuntimeContext } from "./context-env.js";

if (process.env.FORCE_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

maybeReexecViaBbCli();

const program = new Command();

program
  .name("bb")
  .description("BB CLI - manage your AI coding agents")
  .enablePositionalOptions()
  .exitOverride()
  .showSuggestionAfterError(false)
  .version(resolveBbCliVersion());

const KNOWN_COMMAND_NAMES: ReadonlySet<string> = new Set([
  ...CORE_COMMAND_GROUPS.map((group) => group.name),
  "help",
]);

type ContextEnvModule = typeof import("./context-env.js");

function createCommandGroupDeps(
  contextEnv: ContextEnvModule,
): CommandGroupDeps {
  let cliRuntimeContext: CliRuntimeContext | undefined;
  const getCliRuntimeContext = (): CliRuntimeContext =>
    (cliRuntimeContext ??= contextEnv.createCliRuntimeContext());
  return {
    getUrl: () => contextEnv.resolveServerUrl(getCliRuntimeContext()),
    getContext: () => contextEnv.resolveContextSnapshot(getCliRuntimeContext()),
  };
}

async function tryPluginCommandProxy(
  candidate: string,
  getUrl: () => string,
): Promise<void> {
  const proxy = await import("./plugin-cli-proxy.js");
  const result = await proxy.fetchPluginCliContributions(getUrl());
  if (result.outcome === "unreachable") {
    console.error(
      proxy.describeUnreachableServer(
        getUrl(),
        result.cause,
        result.lastTimeoutMs,
        result.attempts,
      ),
    );
    process.exit(1);
  }
  if (result.outcome === "invalid") return;
  const match = proxy.findPluginCliCommand(result.contributions, candidate);
  if (match === undefined) {
    const disabledId = await proxy.findDisabledPluginForCommand(
      getUrl(),
      candidate,
    );
    if (disabledId !== null) {
      console.error(
        `bb ${candidate} is provided by the "${disabledId}" plugin, which is disabled — ` +
          `run \`bb plugin enable ${disabledId}\` or enable it in Plugins.`,
      );
      process.exit(1);
    }
    return;
  }
  const argv = process.argv.slice(3);
  const command = match.commands.find((entry) => entry.name === argv[0]);
  if (
    command !== undefined &&
    match.rendersHelp !== true &&
    argv.slice(1).some((arg) => arg === "--help" || arg === "-h")
  ) {
    console.log(command.usage);
    process.exit(0);
  }
  const exitCode = await proxy.runPluginCliCommand(
    getUrl(),
    match.pluginId,
    argv,
  );
  if (exitCode !== 0) {
    await logCliError({
      code: "plugin_command_failed",
      command: proxy.pluginCommandLabel(match, argv),
      exitCode,
      token: null,
    });
  }
  process.exit(exitCode);
}

async function logCliError(args: {
  code: string;
  command: string | null;
  exitCode: number;
  token: string | null;
}): Promise<void> {
  const [{ appendCliErrorLogEntry }, { commandPathLabel }] = await Promise.all([
    import("./cli-error-log.js"),
    import("./commander-errors.js"),
  ]);
  appendCliErrorLogEntry({
    at: new Date().toISOString(),
    cliVersion: resolveBbCliVersion(),
    code: args.code,
    command: args.command ?? commandPathLabel(program, process.argv),
    exitCode: args.exitCode,
    threadId: process.env.BB_THREAD_ID ?? null,
    token: args.token,
  });
}

async function exitForCommanderError(
  error: CommanderError,
  getUrl: (() => string) | null,
): Promise<never> {
  if (error.exitCode === 0) process.exit(0);
  const [errors, hints] = await Promise.all([
    import("./commander-errors.js"),
    import("./context-hints.js"),
  ]);
  const summary = await errors.summarizeCommanderError({
    argv: process.argv,
    error,
    program,
    resolveHostId:
      getUrl === null
        ? async () => null
        : hints.createContextHostIdResolver(getUrl),
  });
  errors.writeCommanderErrorSummary(summary, process.argv);
  await logCliError({
    code: summary.code,
    command: null,
    exitCode: error.exitCode,
    token: summary.token,
  });
  process.exit(error.exitCode);
}

async function parseProgram(getUrl: (() => string) | null): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      await exitForCommanderError(error, getUrl);
    }
    throw error;
  }
}

async function rejectHelpForUnknownSubcommand(
  getUrl: () => string,
): Promise<void> {
  const resolution = await import("./command-resolution.js");
  if (!resolution.hasHelpFlag(process.argv)) return;
  const invocation = resolution.resolveInvocation(program, process.argv);
  if (invocation.unknownSubcommand === null) return;
  const message = `error: unknown command '${invocation.unknownSubcommand}'`;
  console.error(message);
  await exitForCommanderError(
    new CommanderError(1, "commander.unknownCommand", message),
    getUrl,
  );
}

async function addJsonShapeHelp(): Promise<void> {
  const [{ JSON_SHAPE_BY_COMMAND_PATH, jsonShapeHelp }, resolution] =
    await Promise.all([
      import("./json-shapes.js"),
      import("./command-resolution.js"),
    ]);
  for (const commandPath of Object.keys(JSON_SHAPE_BY_COMMAND_PATH)) {
    const invocation = resolution.resolveInvocation(program, [
      "node",
      "bb",
      ...commandPath.split(" "),
    ]);
    const help = jsonShapeHelp(commandPath);
    if (help === null || invocation.path.join(" ") !== commandPath) continue;
    invocation.command.addHelpText("after", help);
  }
}

async function main(): Promise<void> {
  const firstArg = process.argv[2];
  const groups = selectCommandGroups(firstArg);
  if (groups.length === 0) {
    await parseProgram(null);
    return;
  }

  const [contextEnv, ...registrars] = await Promise.all([
    import("./context-env.js"),
    ...groups.map((group) => group.load()),
  ]);
  const deps = createCommandGroupDeps(contextEnv);

  program.addHelpText("after", () => {
    const context = deps.getContext();
    const project = context.projectId ?? "<unset>";
    const thread = context.threadId ?? "<unset>";

    return `

Current context:
  BB_PROJECT_ID: ${project}
  BB_THREAD_ID: ${thread}
  BB_SERVER_URL: ${context.serverUrl}

Quick start:
  bb status
  bb project list
  bb thread show <id>
  bb thread spawn --project <id> --provider codex --prompt "..."
`;
  });

  for (const register of registrars) {
    register(program, deps);
  }
  await addJsonShapeHelp();

  const candidate = pluginProxyCandidate(firstArg, KNOWN_COMMAND_NAMES);
  if (candidate !== null) {
    await tryPluginCommandProxy(candidate, deps.getUrl);
    const { TOP_LEVEL_SOFT_ALIASES } = await import("./command-resolution.js");
    const aliasTarget = TOP_LEVEL_SOFT_ALIASES[candidate];
    if (aliasTarget !== undefined) process.argv[2] = aliasTarget;
  }
  await rejectHelpForUnknownSubcommand(deps.getUrl);
  await parseProgram(deps.getUrl);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
