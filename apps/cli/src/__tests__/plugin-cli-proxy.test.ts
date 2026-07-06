import { describe, expect, it } from "vitest";
import { Command } from "commander";

import { registerEnvironmentCommands } from "../commands/environment.js";
import { registerGuideCommand } from "../commands/guide.js";
import { registerManagerCommands } from "../commands/manager.js";
import { registerPluginCommands } from "../commands/plugin.js";
import { registerProjectCommands } from "../commands/project.js";
import { registerProviderCommands } from "../commands/provider.js";
import { registerStatusCommand } from "../commands/status.js";
import { registerThemeCommands } from "../commands/theme.js";
import { registerThreadCommands } from "../commands/thread/index.js";
import { registerUiCommands } from "../commands/ui.js";
import {
  findPluginCliCommand,
  pluginProxyCandidate,
  type PluginCliContributionEntry,
} from "../plugin-cli-proxy.js";

// Mirror of RESERVED_BB_CLI_COMMANDS in
// apps/server/src/services/plugins/plugin-api.ts — the server rejects plugin
// CLI commands shadowing core bb commands. Update both together.
const RESERVED_BB_CLI_COMMANDS = [
  "environment",
  "guide",
  "help",
  "manager",
  "plugin",
  "project",
  "provider",
  "status",
  "theme",
  "thread",
  "ui",
];

function buildProgram(): Command {
  const program = new Command();
  const getUrl = () => "http://localhost";
  registerStatusCommand(program, getUrl);
  registerProjectCommands(program, getUrl);
  registerProviderCommands(program, getUrl);
  registerManagerCommands(program, getUrl);
  registerThreadCommands(program, getUrl);
  registerEnvironmentCommands(program, getUrl);
  registerThemeCommands(program, getUrl);
  registerUiCommands(program, getUrl);
  registerPluginCommands(program, getUrl);
  registerGuideCommand(program);
  return program;
}

function topLevelCommandNames(program: Command): string[] {
  return program.commands.flatMap((command) => [
    command.name(),
    ...command.aliases(),
  ]);
}

describe("reserved bb CLI command names", () => {
  it("every core top-level command is on the server's reserved list", () => {
    const names = topLevelCommandNames(buildProgram());
    const reserved = new Set(RESERVED_BB_CLI_COMMANDS);
    for (const name of names) {
      expect(reserved, `"${name}" is missing from RESERVED_BB_CLI_COMMANDS`).toContain(
        name,
      );
    }
  });

  it("the reserved list carries no stale entries", () => {
    const names = new Set(topLevelCommandNames(buildProgram()));
    names.add("help"); // commander built-in
    for (const reserved of RESERVED_BB_CLI_COMMANDS) {
      expect(names, `"${reserved}" is reserved but not a core command`).toContain(
        reserved,
      );
    }
  });
});

describe("pluginProxyCandidate", () => {
  const known = new Set(["thread", "plugin", "help"]);

  it("returns unknown command names", () => {
    expect(pluginProxyCandidate("linear", known)).toBe("linear");
  });

  it("never proxies flags, empty args, or core commands", () => {
    expect(pluginProxyCandidate(undefined, known)).toBeNull();
    expect(pluginProxyCandidate("", known)).toBeNull();
    expect(pluginProxyCandidate("--version", known)).toBeNull();
    expect(pluginProxyCandidate("-h", known)).toBeNull();
    expect(pluginProxyCandidate("thread", known)).toBeNull();
    expect(pluginProxyCandidate("help", known)).toBeNull();
  });
});

describe("findPluginCliCommand", () => {
  const contributions: PluginCliContributionEntry[] = [
    { pluginId: "linear", name: "linear", summary: "Linear", commands: [] },
    { pluginId: "acme", name: "acme-tools", summary: "Acme", commands: [] },
  ];

  it("matches on the registered command name, not the plugin id", () => {
    expect(findPluginCliCommand(contributions, "acme-tools")?.pluginId).toBe(
      "acme",
    );
    expect(findPluginCliCommand(contributions, "acme")).toBeUndefined();
    expect(findPluginCliCommand(contributions, "linear")?.pluginId).toBe(
      "linear",
    );
  });
});
