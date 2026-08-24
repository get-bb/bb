#!/usr/bin/env node
import { Command } from "commander";
import { maybeReexecViaBbCli } from "./bb-cli-reexec.js";
import {
  CORE_COMMAND_GROUPS,
  type CommandGroupDeps,
  pluginProxyCandidate,
  selectCommandGroups,
} from "./command-groups.js";
import { resolveBbCliVersion } from "./version.js";
// Type-only: context-env itself is `import()`-ed in main() so that the config
// and domain schemas behind it stay out of the `bb --version` startup graph.
import type { CliRuntimeContext } from "./context-env.js";

// Hop to the daemon-managed binary when BB_CLI is set (agent shell env). Must
// run before Commander so flags/help match the intended build.
maybeReexecViaBbCli();

const program = new Command();

program
  .name("bb")
  .description("BB CLI - manage your AI coding agents")
  // Program flags (--version/--help) must precede the subcommand; required
  // so `bb plugin run <id> --flag` passes flags through to the plugin.
  .enablePositionalOptions()
  .version(resolveBbCliVersion());

const KNOWN_COMMAND_NAMES: ReadonlySet<string> = new Set([
  ...CORE_COMMAND_GROUPS.map((group) => group.name),
  "help", // commander built-in
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

/**
 * Unknown top-level commands may be plugin-contributed `bb` subcommands
 * (design §4.4): before letting commander error, ask the server for plugin
 * CLI contributions (short timeout, silent fallback) and proxy on a match.
 * Core commands always win — this only runs for names commander doesn't own.
 */
async function tryPluginCommandProxy(
  candidate: string,
  getUrl: () => string,
): Promise<void> {
  const proxy = await import("./plugin-cli-proxy.js");
  const result = await proxy.fetchPluginCliContributions(getUrl());
  if (result.outcome === "unreachable") {
    // The candidate may be a plugin command (`bb connect` on a fresh
    // machine is the canonical case) — only the running server can say, so
    // an unreachable server must not degrade into commander's "unknown
    // command".
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
    // Disabled plugins contribute no commands; explain instead of erroring
    // when the name matches an installed-but-disabled plugin's id.
    const disabled = await proxy.findDisabledPluginForCommand(
      getUrl(),
      candidate,
    );
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
    await proxy.runPluginCliCommand(
      getUrl(),
      match.pluginId,
      process.argv.slice(3),
    ),
  );
}

async function main(): Promise<void> {
  const firstArg = process.argv[2];
  const groups = selectCommandGroups(firstArg);
  if (groups.length === 0) {
    // `bb --version`: nothing beyond commander itself is needed.
    await program.parseAsync(process.argv);
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

  const candidate = pluginProxyCandidate(firstArg, KNOWN_COMMAND_NAMES);
  if (candidate !== null) {
    await tryPluginCommandProxy(candidate, deps.getUrl);
  }
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
