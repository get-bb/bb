#!/usr/bin/env node
import { Command } from "commander";
import { maybeReexecViaBbCli } from "./bb-cli-reexec.js";
import { registerEnvironmentCommands } from "./commands/environment.js";
import { registerFileCommands } from "./commands/file.js";
import { registerGuideCommand } from "./commands/guide.js";
import { registerManagerCommands } from "./commands/manager.js";
import { registerMarketplaceCommands } from "./commands/marketplace.js";
import { registerMachineCommands } from "./commands/machine.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerPluginCommands } from "./commands/plugin.js";
import { registerProviderCommands } from "./commands/provider.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerTerminalCommands } from "./commands/terminal.js";
import { registerSettingsCommands } from "./commands/settings.js";
import { registerSkillCommands } from "./commands/skill.js";
import { registerThemeCommands } from "./commands/theme.js";
import { registerThreadCommands } from "./commands/thread/index.js";
import { registerUpdatesCommands } from "./commands/updates.js";
import { registerVoiceCommands } from "./commands/voice.js";
import {
  createCliRuntimeContext,
  resolveContextSnapshot,
  resolveServerUrl,
  type CliRuntimeContext,
} from "./context-env.js";
import {
  describeUnreachableServer,
  fetchPluginCliContributions,
  findDisabledPluginForCommand,
  findPluginCliCommand,
  pluginProxyCandidate,
  runPluginCliCommand,
} from "./plugin-cli-proxy.js";
import { resolveBbCliVersion } from "./version.js";

// Hop to the daemon-managed binary when BB_CLI is set (agent shell env). Must
// run before Commander so flags/help match the intended build.
maybeReexecViaBbCli();

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
registerSettingsCommands(program, getUrl);
registerProjectCommands(program, getUrl);
registerProviderCommands(program, getUrl);
registerManagerCommands(program, getUrl);
registerMachineCommands(program, getUrl);
registerUpdatesCommands(program, getUrl);
registerTerminalCommands(program, getUrl);
registerThreadCommands(program, getUrl);
registerEnvironmentCommands(program, getUrl);
registerFileCommands(program, getUrl);
registerThemeCommands(program, getUrl);
registerPluginCommands(program, getUrl);
registerMarketplaceCommands(program, getUrl);
registerSkillCommands(program, getUrl, getContext);
registerGuideCommand(program);
registerVoiceCommands(program, getUrl);

/**
 * Unknown top-level commands may be plugin-contributed `bb` subcommands
 * (design §4.4): before letting commander error, ask the server for plugin
 * CLI contributions (short timeout, silent fallback) and proxy on a match.
 * Core commands always win — this only runs for names commander doesn't own.
 */
async function tryPluginCommandProxy(): Promise<void> {
  const knownCommandNames = new Set(
    program.commands.flatMap((command) => [
      command.name(),
      ...command.aliases(),
    ]),
  );
  knownCommandNames.add("help");
  const candidate = pluginProxyCandidate(process.argv[2], knownCommandNames);
  if (candidate === null) return;
  const result = await fetchPluginCliContributions(getUrl());
  if (result.outcome === "unreachable") {
    // The candidate may be a plugin command (`bb connect` on a fresh
    // machine is the canonical case) — only the running server can say, so
    // an unreachable server must not degrade into commander's "unknown
    // command".
    console.error(
      describeUnreachableServer(
        getUrl(),
        result.cause,
        result.lastTimeoutMs,
        result.attempts,
      ),
    );
    process.exit(1);
  }
  if (result.outcome === "invalid") return;
  const match = findPluginCliCommand(result.contributions, candidate);
  if (match === undefined) {
    // Disabled plugins contribute no commands; explain instead of erroring
    // when the name matches an installed-but-disabled plugin's id.
    const disabled = await findDisabledPluginForCommand(getUrl(), candidate);
    if (disabled !== null) {
      console.error(
        `bb ${candidate} is provided by the "${disabled.id}" plugin, which is disabled — ` +
          `run \`bb plugin enable ${disabled.id}\` or enable it in Plugins.`,
      );
      process.exit(1);
    }
    return;
  }
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
