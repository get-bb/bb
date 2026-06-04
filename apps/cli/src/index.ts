#!/usr/bin/env node
import { Command } from "commander";
import { registerAppCommands } from "./commands/app.js";
import { registerEnvironmentCommands } from "./commands/environment.js";
import { registerGuideCommand } from "./commands/guide.js";
import { registerHostCommands } from "./commands/host.js";
import { registerManagerCommands } from "./commands/manager.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerProviderCommands } from "./commands/provider.js";
import { registerReplayCommands } from "./commands/replay.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerThreadCommands } from "./commands/thread/index.js";
import {
  createCliRuntimeContext,
  resolveContextSnapshot,
  resolveServerUrl,
  type CliRuntimeContext,
} from "./context-env.js";
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
  bb thread show
  bb thread spawn --provider codex --prompt "..."
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
registerHostCommands(program, getUrl);
registerProviderCommands(program, getUrl);
registerManagerCommands(program, getUrl);
registerAppCommands(program, getUrl);
registerThreadCommands(program, getUrl);
registerReplayCommands(program, getUrl);
registerEnvironmentCommands(program, getUrl);
registerGuideCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
