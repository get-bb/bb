import { Command } from "commander";
import {
  AI_TASKS,
  AI_TEXT_TASKS,
  aiTaskSchema,
  aiTextTaskSchema,
  keyboardCommandIdSchema,
  appShortcutSchema,
  appSettingsSchema,
  completedTurnDisplaySchema,
  describeUiPreference,
  experimentKeySchema,
  experimentsSchema,
  isUiPreferenceKey,
  parseUiPreferenceValue,
  UI_PREFERENCE_KEYS,
  type AiServiceSelection,
  type AiTask,
  type AppSettings,
  type AppShortcut,
  type CompletedTurnDisplay,
  type Experiments,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import { BbHttpError } from "@bb/sdk";
import type {
  SystemAiServicesResponse,
  SystemProviderInfo,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import { resolveMachineHostId, resolveMachineTargetOption } from "./machine.js";

interface JsonOptions {
  json?: boolean;
}

function requireAiTask(input: string): AiTask {
  const task = aiTaskSchema.safeParse(input);
  if (!task.success) {
    throw new Error(`Unknown task '${input}'. Tasks: ${AI_TASKS.join(", ")}`);
  }
  return task.data;
}

function resolveAiServiceChoice(
  view: SystemAiServicesResponse,
  task: AiTask,
  choice: string,
): AiServiceSelection {
  if (choice === "automatic" || choice === "off") return { mode: choice };
  const service = view.services.find((candidate) => candidate.id === choice);
  const eligible = view.services
    .filter((candidate) => candidate.tasks.includes(task))
    .map((candidate) => candidate.id);
  if (service === undefined || !service.tasks.includes(task)) {
    throw new Error(
      `No AI service '${choice}' handles ${task}. Choose automatic, off${eligible.length > 0 ? `, or one of: ${eligible.join(", ")}` : ""}.`,
    );
  }
  return { mode: "service", pluginId: service.pluginId, serviceId: service.id };
}

function automaticAiServiceFor(
  view: SystemAiServicesResponse,
  task: AiTask,
): SystemAiServicesResponse["services"][number] | null {
  return (
    view.services
      .filter(
        (service) =>
          service.automaticRank !== null &&
          service.tasks.includes(task) &&
          service.status.ready,
      )
      .sort((a, b) => (a.automaticRank ?? 0) - (b.automaticRank ?? 0))[0] ??
    null
  );
}

function describeAiSelection(
  view: SystemAiServicesResponse,
  selection: AiServiceSelection,
): string {
  if (selection.mode === "off") return "Off";
  if (selection.mode === "service") {
    const service = view.services.find(
      (candidate) =>
        candidate.id === selection.serviceId &&
        candidate.pluginId === selection.pluginId,
    );
    return service === undefined
      ? `${selection.serviceId} (unavailable plugin ${selection.pluginId})`
      : service.displayName;
  }
  return "Automatic";
}

function printAiServices(view: SystemAiServicesResponse): void {
  for (const task of AI_TASKS) {
    const selection = view.selections[task];
    const automatic =
      selection.mode === "automatic" ? automaticAiServiceFor(view, task) : null;
    const using =
      selection.mode !== "automatic"
        ? ""
        : automatic === null
          ? " (nothing ready)"
          : ` (using ${automatic.displayName})`;
    console.log(
      `${task.padEnd(16)}${describeAiSelection(view, selection)}${using}`,
    );
  }
  console.log("");
  if (view.services.length === 0) {
    console.log("No plugin registers an AI service.");
    return;
  }
  console.log("Services:");
  for (const service of view.services) {
    const status = service.status.ready
      ? "ready"
      : `not ready: ${service.status.message}`;
    const automatic =
      service.automaticRank === null
        ? ""
        : `  Automatic #${service.automaticRank + 1}`;
    console.log(
      `  ${service.id}  ${service.displayName}  plugin ${service.pluginId}  [${service.tasks.join(", ")}]${automatic}  ${status}`,
    );
  }
}

interface ProviderCompletedTurnDisplayEntry {
  providerId: string;
  displayName: string;
  completedTurnDisplay: CompletedTurnDisplay;
  providerDefault: CompletedTurnDisplay;
  source: "setting" | "provider-default";
}

interface UsageOptions extends JsonOptions {
  host?: string;
  machine?: string;
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

function generalSettingValueCandidates(value: string): unknown[] {
  if (value === "on") return [true, value];
  if (value === "off") return [false, value];
  try {
    return [JSON.parse(value), value];
  } catch {
    return [value];
  }
}

function updateGeneralSetting(
  settings: AppSettings,
  key: string,
  value: string,
): AppSettings {
  const settingKey = appSettingsSchema.keyof().safeParse(key);
  if (!settingKey.success) {
    throw new Error(
      `Unknown general setting '${key}'. Known settings: ${appSettingsSchema
        .keyof()
        .options.join(", ")}.`,
    );
  }

  for (const candidate of generalSettingValueCandidates(value)) {
    const updated = appSettingsSchema.strip().safeParse({
      ...settings,
      [settingKey.data]: candidate,
    });
    if (updated.success) return updated.data;
  }

  throw new Error(
    `Invalid value '${value}' for '${settingKey.data}'. Booleans take true, false, on, or off, null clears a nullable setting, and structured values take JSON.`,
  );
}

function describeProviderCompletedTurnDisplay(
  settings: AppSettings,
  provider: SystemProviderInfo,
): ProviderCompletedTurnDisplayEntry {
  const override = settings.providerCompletedTurnDisplay[provider.id];
  return {
    providerId: provider.id,
    displayName: provider.displayName,
    completedTurnDisplay: override ?? provider.completedTurnDisplay,
    providerDefault: provider.completedTurnDisplay,
    source: override === undefined ? "provider-default" : "setting",
  };
}

function printCompletedTurnDisplayTable(
  entries: readonly ProviderCompletedTurnDisplayEntry[],
): void {
  const rows = entries.map((entry) => [
    entry.providerId,
    entry.displayName,
    entry.completedTurnDisplay,
    entry.source === "setting" ? "setting" : "provider default",
  ]);
  printBorderlessTable(
    {
      head: ["ID", "Name", "Finished turns", "Source"],
      colWidths: columnWidths(rows, [2, 4, 14, 6]),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}

function parseCompletedTurnDisplayInput(
  value: string,
): CompletedTurnDisplay | null {
  if (value === "default") return null;
  const parsed = completedTurnDisplaySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid finished turn display '${value}'. Use collapse, flat, or default.`,
    );
  }
  return parsed.data;
}

function updateProviderCompletedTurnDisplay(
  settings: AppSettings,
  providerId: string,
  display: CompletedTurnDisplay | null,
): AppSettings {
  const remaining = Object.fromEntries(
    Object.entries(settings.providerCompletedTurnDisplay).filter(
      ([id]) => id !== providerId,
    ),
  );
  return appSettingsSchema.strip().parse({
    ...settings,
    providerCompletedTurnDisplay:
      display === null ? remaining : { ...remaining, [providerId]: display },
  });
}

function requireKnownProvider(
  providers: readonly SystemProviderInfo[],
  providerId: string,
): SystemProviderInfo {
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (provider !== undefined) return provider;
  throw new Error(
    `Unknown provider '${providerId}'. Known providers: ${providers
      .map((candidate) => candidate.id)
      .join(", ")}.`,
  );
}

function updateExperiment(
  experiments: Experiments,
  key: string,
  value: string,
): Experiments {
  const enabled = parseBoolean(value);
  const experimentKey = experimentKeySchema.safeParse(key);
  if (!experimentKey.success) {
    throw new Error(`Unknown experiment '${key}'.`);
  }
  return experimentsSchema.parse({
    ...experiments,
    [experimentKey.data]: enabled,
  });
}

function requireUiPreferenceKey(key: string): UiPreferenceKey {
  if (isUiPreferenceKey(key)) return key;
  throw new Error(
    `Unknown UI preference '${key}'. Known preferences: ${UI_PREFERENCE_KEYS.join(", ")}.`,
  );
}

function uiPreferenceValueCandidates(value: string): unknown[] {
  try {
    return [JSON.parse(value), value];
  } catch {
    return [value];
  }
}

function parseUiPreferenceInput<Key extends UiPreferenceKey>(
  key: Key,
  value: string,
): UiPreferenceValue<Key> {
  let message = "";
  for (const candidate of uiPreferenceValueCandidates(value)) {
    const parsed = parseUiPreferenceValue(key, candidate);
    if (parsed.success) return parsed.value;
    message = parsed.message;
  }
  throw new Error(
    `Invalid value '${value}' for '${key}': ${message}. Lists and null take JSON; plain strings may be unquoted.`,
  );
}

function isUiPreferenceConflict(error: unknown): boolean {
  return error instanceof BbHttpError && error.status === 409;
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

  const aiServices = settings
    .command("ai-services")
    .description(
      "Choose which plugin AI service writes thread titles, commit messages, and voice transcripts",
    );
  aiServices
    .command("show", { isDefault: true })
    .description("Show each task's selection and every registered AI service")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const result = await createCliBbSdk(getUrl()).system.aiServices();
        if (outputJson(opts, result)) return;
        printAiServices(result);
      }),
    );
  aiServices
    .command("set <task> <choice>")
    .description(
      `Set the service for a task (${AI_TASKS.join(", ")}): automatic, off, or a service id`,
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (taskInput: string, choice: string, opts: JsonOptions) => {
        const task = requireAiTask(taskInput);
        const sdk = createCliBbSdk(getUrl());
        const current = await sdk.system.aiServices();
        const result = await sdk.system.setAiServiceSelection({
          task,
          selection: resolveAiServiceChoice(current, task, choice),
        });
        if (outputJson(opts, result)) return;
        console.log(
          `${task}: ${describeAiSelection(result, result.selections[task])}`,
        );
      }),
    );
  aiServices
    .command("test <task>")
    .description(
      `Run a sample through the current choice for ${AI_TEXT_TASKS.join(" or ")}`,
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (taskInput: string, opts: JsonOptions) => {
        const task = aiTextTaskSchema.safeParse(taskInput);
        if (!task.success) {
          throw new Error(
            `Unknown task '${taskInput}'. Testable tasks: ${AI_TEXT_TASKS.join(", ")}`,
          );
        }
        const result = await createCliBbSdk(getUrl()).system.testAiService({
          task: task.data,
        });
        if (outputJson(opts, result)) return;
        if (result.ok) {
          console.log(
            `${result.displayName} (${result.durationMs}ms): ${result.text}`,
          );
          return;
        }
        console.log(`Failed after ${result.durationMs}ms: ${result.message}`);
        process.exitCode = 1;
      }),
    );

  settings
    .command("general <key> <value>")
    .description("Set a Settings → General preference")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (key: string, value: string, opts: JsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const config = await sdk.system.config();
        const result = await sdk.system.updateGeneralSettings(
          updateGeneralSetting(config.generalSettings, key, value),
        );
        if (outputJson(opts, result)) return;
        console.log(`${key} updated`);
      }),
    );

  settings
    .command("completed-turns [providerId] [display]")
    .description(
      "Show or set whether each provider's finished turns collapse or stay flat (collapse, flat, or default)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          providerId: string | undefined,
          display: string | undefined,
          opts: JsonOptions,
        ) => {
          const sdk = createCliBbSdk(getUrl());
          const [config, providers] = await Promise.all([
            sdk.system.config(),
            sdk.providers.list(),
          ]);
          if (providerId === undefined) {
            const entries = providers.map((provider) =>
              describeProviderCompletedTurnDisplay(
                config.generalSettings,
                provider,
              ),
            );
            if (outputJson(opts, entries)) return;
            if (entries.length === 0) {
              console.log("No providers available");
              return;
            }
            printCompletedTurnDisplayTable(entries);
            return;
          }
          const provider = requireKnownProvider(providers, providerId);
          if (display === undefined) {
            const entry = describeProviderCompletedTurnDisplay(
              config.generalSettings,
              provider,
            );
            if (outputJson(opts, entry)) return;
            printCompletedTurnDisplayTable([entry]);
            return;
          }
          const updated = await sdk.system.updateGeneralSettings(
            updateProviderCompletedTurnDisplay(
              config.generalSettings,
              provider.id,
              parseCompletedTurnDisplayInput(display),
            ),
          );
          const entry = describeProviderCompletedTurnDisplay(updated, provider);
          if (outputJson(opts, entry)) return;
          console.log(
            `${provider.id} finished turns: ${entry.completedTurnDisplay} (${
              entry.source === "setting" ? "setting" : "provider default"
            })`,
          );
        },
      ),
    );

  const ui = settings
    .command("ui")
    .description(
      "Manage server-synced UI preferences such as sidebar layout and navigation",
    );
  ui.command("list")
    .description("List every UI preference with its value and revision")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const result =
          await createCliBbSdk(getUrl()).system.uiPreferences.list();
        if (outputJson(opts, result)) return;
        for (const key of UI_PREFERENCE_KEYS) {
          const entry = result.preferences[key];
          console.log(
            `${key}  ${JSON.stringify(entry.value)}  (revision ${entry.revision})`,
          );
          console.log(`  ${describeUiPreference(key)}`);
        }
      }),
    );
  ui.command("get <key>")
    .description("Show one UI preference")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (keyInput: string, opts: JsonOptions) => {
        const key = requireUiPreferenceKey(keyInput);
        const { preferences } =
          await createCliBbSdk(getUrl()).system.uiPreferences.list();
        const entry = preferences[key];
        if (outputJson(opts, { key, ...entry })) return;
        console.log(JSON.stringify(entry.value));
      }),
    );
  ui.command("set <key> <value>")
    .description("Set a UI preference; lists and null take JSON")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (keyInput: string, value: string, opts: JsonOptions) => {
        const key = requireUiPreferenceKey(keyInput);
        const parsedValue = parseUiPreferenceInput(key, value);
        const sdk = createCliBbSdk(getUrl());
        const write = async () => {
          const { preferences } = await sdk.system.uiPreferences.list();
          return sdk.system.uiPreferences.set({
            expectedRevision: preferences[key].revision,
            key,
            value: parsedValue,
          });
        };
        let result;
        try {
          result = await write();
        } catch (error) {
          if (!isUiPreferenceConflict(error)) throw error;
          result = await write();
        }
        if (outputJson(opts, result)) return;
        console.log(`${key} updated`);
      }),
    );
  ui.command("reset <key>")
    .description("Reset a UI preference to its default")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (keyInput: string, opts: JsonOptions) => {
        const key = requireUiPreferenceKey(keyInput);
        const result = await createCliBbSdk(
          getUrl(),
        ).system.uiPreferences.reset({ key });
        if (outputJson(opts, result)) return;
        console.log(`${key} reset`);
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
    .description("Manage keyboard settings and shortcut overrides");
  keyboard
    .command("hints <value>")
    .description("Show or hide held-modifier shortcut hints")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (value: string, opts: JsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const config = await sdk.system.config();
        const result = await sdk.system.updateGeneralSettings(
          updateGeneralSetting(
            config.generalSettings,
            "showKeyboardHints",
            value,
          ),
        );
        if (outputJson(opts, result)) return;
        console.log("Keyboard hint visibility updated");
      }),
    );
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
          const command = keyboardCommandIdSchema.parse(commandInput);
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
                  item.command !== keyboardCommandIdSchema.parse(commandInput),
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
    .option(
      "--machine <id-or-name>",
      "Machine whose provider usage should be shown",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: UsageOptions) => {
        const target = resolveMachineTargetOption(opts);
        const hostId =
          target === undefined
            ? undefined
            : await resolveMachineHostId({
                serverUrl: getUrl(),
                target,
              });
        const result = await createCliBbSdk(getUrl()).system.usageLimits(
          hostId === undefined ? {} : { hostId },
        );
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
