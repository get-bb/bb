import { Command } from "commander";
import {
  appCommandIdSchema,
  appShortcutSchema,
  appSettingsSchema,
  experimentsSchema,
  type AppSettings,
  type AppShortcut,
  type Experiments,
} from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface JsonOptions {
  json?: boolean;
}

function parseBoolean(value: string): boolean {
  if (value === "true" || value === "on") return true;
  if (value === "false" || value === "off") return false;
  throw new Error("value must be true, false, on, or off.");
}

function parseShortcut(value: string): AppShortcut {
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (key === undefined) throw new Error("shortcut must include a key.");
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  for (const modifier of modifiers) {
    if (
      !["mod", "meta", "control", "ctrl", "alt", "shift"].includes(modifier)
    ) {
      throw new Error(`Unknown shortcut modifier '${modifier}'.`);
    }
  }
  return appShortcutSchema.parse({
    key,
    mod: modifiers.has("mod"),
    meta: modifiers.has("meta"),
    control: modifiers.has("control") || modifiers.has("ctrl"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift"),
  });
}

function updateGeneralSetting(
  settings: AppSettings,
  key: string,
  value: boolean,
): AppSettings {
  switch (key) {
    case "caffeinate":
    case "codexMemoryEnabled":
    case "claudeCodeMemoryEnabled":
    case "codexSubagentsDisabled":
    case "claudeCodeSubagentsDisabled":
    case "claudeCodeWorkflowsDisabled":
      return appSettingsSchema.parse({ ...settings, [key]: value });
    default:
      throw new Error(`Unknown general setting '${key}'.`);
  }
}

function updateExperiment(
  experiments: Experiments,
  key: string,
  value: string,
): Experiments {
  if (key === "popoutChatHotkey") {
    return experimentsSchema.parse({ ...experiments, popoutChatHotkey: value });
  }
  const enabled = parseBoolean(value);
  switch (key) {
    case "bbConnect":
    case "claudeCodeMockCliTraffic":
    case "multiMachine":
    case "plugins":
    case "popoutChat":
      return experimentsSchema.parse({ ...experiments, [key]: enabled });
    default:
      throw new Error(`Unknown experiment '${key}'.`);
  }
}

export function registerSettingsCommands(
  program: Command,
  getUrl: () => string,
): void {
  const settings = program
    .command("settings")
    .description("Inspect and update BB settings");

  settings
    .command("show")
    .description("Show server-backed settings and feature state")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const result = await createCliBbSdk(getUrl()).system.config();
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  settings
    .command("general <key> <value>")
    .description("Set a boolean Settings → General preference")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (key: string, value: string, opts: JsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const config = await sdk.system.config();
        const result = await sdk.system.updateGeneralSettings(
          updateGeneralSetting(
            config.generalSettings,
            key,
            parseBoolean(value),
          ),
        );
        if (outputJson(opts, result)) return;
        console.log(`${key} updated`);
      }),
    );

  settings
    .command("experiment <key> <value>")
    .description("Set an experiment value")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (key: string, value: string, opts: JsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const config = await sdk.system.config();
        const result = await sdk.system.updateExperiments(
          updateExperiment(config.experiments, key, value),
        );
        if (outputJson(opts, result)) return;
        console.log(`${key} updated`);
      }),
    );

  const keyboard = settings
    .command("keyboard")
    .description("Manage keyboard shortcut overrides");
  keyboard
    .command("list")
    .description("List effective keybindings and overrides")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const config = await createCliBbSdk(getUrl()).system.config();
        const result = {
          bindings: config.keybindings,
          overrides: config.keybindingOverrides,
        };
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );
  keyboard
    .command("set <command> <shortcut>")
    .description("Set a command shortcut; use 'disabled' to clear it")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (commandInput: string, shortcut: string, opts: JsonOptions) => {
          const command = appCommandIdSchema.parse(commandInput);
          const sdk = createCliBbSdk(getUrl());
          const config = await sdk.system.config();
          const next = config.keybindingOverrides.filter(
            (item) => item.command !== command,
          );
          next.push({
            command,
            shortcut: shortcut === "disabled" ? null : parseShortcut(shortcut),
          });
          const result = await sdk.system.updateKeyboardSettings(next);
          if (outputJson(opts, result)) return;
          console.log(`Shortcut for ${command} updated`);
        },
      ),
    );
  keyboard
    .command("reset [command]")
    .description("Reset one command override or all keyboard overrides")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (commandInput: string | undefined, opts: JsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const config = await sdk.system.config();
        const next =
          commandInput === undefined
            ? []
            : config.keybindingOverrides.filter(
                (item) =>
                  item.command !== appCommandIdSchema.parse(commandInput),
              );
        const result = await sdk.system.updateKeyboardSettings(next);
        if (outputJson(opts, result)) return;
        console.log(
          commandInput
            ? `Shortcut for ${commandInput} reset`
            : "Keyboard overrides reset",
        );
      }),
    );

  settings
    .command("usage")
    .description("Show provider usage limits")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const result = await createCliBbSdk(getUrl()).system.usageLimits();
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  settings
    .command("version")
    .description("Check the running and latest BB versions")
    .option("--force", "Bypass the latest-version cache")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions & { force?: boolean }) => {
        const result = await createCliBbSdk(getUrl()).system.version({
          force: opts.force,
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  settings
    .command("reload")
    .description("Reload BB's managed configuration")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const result = await createCliBbSdk(getUrl()).system.reloadConfig();
        if (outputJson(opts, result)) return;
        console.log("Configuration reloaded");
      }),
    );
}
