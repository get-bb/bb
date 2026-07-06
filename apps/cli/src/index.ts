#!/usr/bin/env node
import { Command } from "commander";
import { registerConnectCommands } from "./commands/connect.js";
import { registerEnvironmentCommands } from "./commands/environment.js";
import { registerGuideCommand } from "./commands/guide.js";
import { registerHostCommands } from "./commands/host.js";
import { registerManagerCommands } from "./commands/manager.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerPluginCommands } from "./commands/plugin.js";
import { registerProviderCommands } from "./commands/provider.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerThemeCommands } from "./commands/theme.js";
import { registerThreadCommands } from "./commands/thread/index.js";
import { registerUiCommands } from "./commands/ui.js";
import {
  createCliRuntimeContext,
  resolveContextSnapshot,
  resolveServerUrl,
  type CliRuntimeContext,
} from "./context-env.js";
import {
  fetchPluginCliContributions,
  findPluginCliCommand,
  pluginProxyCandidate,
  runPluginCliCommand,
} from "./plugin-cli-proxy.js";
import { resolveBbCliVersion } from "./version.js";

const program = new Command();
let cliRuntimeContext: CliRuntimeContext | undefined;

function getCliRuntimeContext(): CliRuntimeContext {
  cliRuntimeContext ??= createCliRuntimeContext();
  return cliRuntimeContext;
}

program
  .name("bb")
  .description("BB CLI - manage your AI coding agents")
  // Program flags (--version/--help) must precede the subcommand; required
  // so `bb plugin run <id> --flag` passes flags through to the plugin.
  .enablePositionalOptions()
  .version(resolveBbCliVersion());

program.addHelpText("after", () => {
  const context = resolveContextSnapshot(getCliRuntimeContext());
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

// Helper to get the URL from the program's options
function getUrl(): string {
  return resolveServerUrl(getCliRuntimeContext());
}

function getContext() {
  return resolveContextSnapshot(getCliRuntimeContext());
}

// Register all command groups
registerStatusCommand(program, getUrl, getContext);
registerProjectCommands(program, getUrl);
registerProviderCommands(program, getUrl);
registerManagerCommands(program, getUrl);
registerThreadCommands(program, getUrl);
registerEnvironmentCommands(program, getUrl);
registerHostCommands(program, getUrl);
registerConnectCommands(program, getUrl);
registerThemeCommands(program, getUrl);
registerUiCommands(program, getUrl);
registerPluginCommands(program, getUrl);
registerGuideCommand(program);

/**
 * Unknown top-level commands may be plugin-contributed `bb` subcommands
 * (design §4.4): before letting commander error, ask the server for plugin
 * CLI contributions (short timeout, silent fallback) and proxy on a match.
 * Core commands always win — this only runs for names commander doesn't own.
 */
async function tryPluginCommandProxy(): Promise<void> {
  const knownCommandNames = new Set(
    program.commands.flatMap((command) => [command.name(), ...command.aliases()]),
  );
  knownCommandNames.add("help");
  const candidate = pluginProxyCandidate(process.argv[2], knownCommandNames);
  if (candidate === null) return;
  const contributions = await fetchPluginCliContributions(getUrl());
  if (contributions === null) return;
  const match = findPluginCliCommand(contributions, candidate);
  if (match === undefined) return;
  process.exit(
    await runPluginCliCommand(getUrl(), match.pluginId, process.argv.slice(3)),
  );
}

tryPluginCommandProxy()
  .then(() => program.parseAsync(process.argv))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
