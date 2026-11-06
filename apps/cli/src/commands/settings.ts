import { flag } from "@bb/operations";
import type { Command } from "commander";
import type { CliDoorOption } from "@bb/operations";
import {
  AI_TASKS,
  AI_TEXT_TASKS,
  aiTaskSchema,
  aiTextTaskSchema,
  keyboardCommandIdSchema,
  keyboardPlatformSchema,
  appShortcutSchema,
  appSettingsSchema,
  completedTurnDisplaySchema,
  describeUiPreference,
  experimentKeySchema,
  isUiPreferenceKey,
  parseUiPreferenceValue,
  UI_PREFERENCE_KEYS,
  type AiServiceSelection,
  type AiTask,
  type AppSettings,
  type AppShortcut,
  type CompletedTurnDisplay,
  type ExperimentUpdates,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import { BbHttpError } from "@bb/sdk";
import type {
  SystemAiServicesResponse,
  SystemCliCommandStatus,
  SystemProviderInfo,
} from "@bb/server-contract";
import {
  clientCommand,
  mountCommands,
  publicCommand,
  type CliClient,
} from "../operation-doors.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { resolveMachineHostId, resolveMachineTargetOption } from "./machine.js";

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function currentConfig(client: CliClient) {
  return client.call("system.config", {});
}

function describeCliCommandStatus(status: SystemCliCommandStatus): string {
  if (!status.supported) {
    return "The bb CLI can be installed for use outside bb only by an installed bb. Start bb with npx bb-app or the desktop app.";
  }
  if (status.installedPath !== null) {
    return status.onPath
      ? `The bb CLI is installed at ${status.installedPath} for use outside bb.`
      : `The bb CLI is installed at ${status.installedPath}, but its folder is not on your PATH. Add the folder to your PATH to use bb outside bb.`;
  }
  if (status.shadowedBy === null) {
    return "The bb CLI is not installed for use outside bb. Run bb settings cli-command install to add it.";
  }
  if (status.shadowedBy.source === "npm") {
    return `bb is already on your PATH at ${status.shadowedBy.path}, installed by npm.`;
  }
  if (status.shadowedBy.source === "machine") {
    return `bb is already on your PATH at ${status.shadowedBy.path}, installed with the bb machine on this computer.`;
  }
  return `The bb CLI is not installed for use outside bb. Another bb at ${status.shadowedBy.path} comes first on your PATH.`;
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
  args: { task: AiTask; choice: string; pluginId: string | undefined },
): AiServiceSelection {
  const { task, choice, pluginId } = args;
  if (choice === "automatic" || choice === "off") {
    if (pluginId !== undefined) {
      throw new Error(`--plugin applies only to a service id, not ${choice}.`);
    }
    return { mode: choice };
  }
  const eligible = view.services.filter((candidate) =>
    candidate.tasks.includes(task),
  );
  const matches = eligible.filter(
    (candidate) =>
      candidate.id === choice &&
      (pluginId === undefined || candidate.pluginId === pluginId),
  );
  const [service] = matches;
  if (service === undefined) {
    const ids = [...new Set(eligible.map((candidate) => candidate.id))];
    const from = pluginId === undefined ? "" : ` from plugin '${pluginId}'`;
    throw new Error(
      `No AI service '${choice}'${from} handles ${task}. Choose automatic, off${ids.length > 0 ? `, or one of: ${ids.join(", ")}` : ""}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Several plugins register AI service '${choice}': ${matches.map((candidate) => candidate.pluginId).join(", ")}. Pass --plugin <plugin-id>.`,
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

  let message: string | null = null;
  for (const candidate of generalSettingValueCandidates(value)) {
    const updated = appSettingsSchema.strip().safeParse({
      ...settings,
      [settingKey.data]: candidate,
    });
    if (updated.success) return updated.data;
    message ??= updated.error.issues[0]?.message ?? null;
  }

  throw new Error(
    `Invalid value '${value}' for '${settingKey.data}'${message === null ? "" : `: ${message}`}. Booleans take true, false, on, or off, null clears a nullable setting, and structured values take JSON.`,
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

function experimentUpdate(key: string, value: string): ExperimentUpdates {
  const enabled = parseBoolean(value);
  const experimentKey = experimentKeySchema.safeParse(key);
  if (!experimentKey.success) {
    throw new Error(`Unknown experiment '${key}'.`);
  }
  return { [experimentKey.data]: enabled };
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

const PLATFORM_OPTION: CliDoorOption = flag(
  "--platform <platform>",
  "Scope to mac, windows, or linux",
);

function platformValue(
  value: unknown,
): "mac" | "windows" | "linux" | undefined {
  const platform = text(value);
  return platform === undefined
    ? undefined
    : keyboardPlatformSchema.parse(platform);
}

const settingsCommands = [
  publicCommand("system.config", {
    path: ["settings", "show"],
    summary: "Show server-backed settings and feature state",
    print: (result) => JSON.stringify(result, null, 2),
  }),
  publicCommand("system.aiServices", {
    path: ["settings", "ai-services", "show"],
    summary: "Show each task's selection and every registered AI service",
    isDefault: true,
    print(result) {
      printAiServices(result);
      return null;
    },
  }),
  publicCommand("system.setAiServiceSelection", {
    path: ["settings", "ai-services", "set"],
    summary: `Set the service for a task (${AI_TASKS.join(", ")}): automatic, off, or a service id`,
    positionals: [{ name: "task" }, { name: "choice" }],
    options: [
      flag(
        "--plugin <plugin-id>",
        "Plugin that registers the service, when several plugins use the same service id",
      ),
    ],
    async prepare({ positionals, options }, client) {
      const task = requireAiTask(text(positionals.task) ?? "");
      const current = await client.call("system.aiServices", {});
      return {
        task,
        selection: resolveAiServiceChoice(current, {
          task,
          choice: text(positionals.choice) ?? "",
          pluginId: text(options.plugin),
        }),
      };
    },
    print: (result, input) =>
      `${input.task}: ${describeAiSelection(result, result.selections[input.task])}`,
  }),
  publicCommand("system.testAiService", {
    path: ["settings", "ai-services", "test"],
    summary: `Run a sample through the current choice for ${AI_TEXT_TASKS.join(" or ")}`,
    positionals: [{ name: "task" }],
    prepare({ positionals }) {
      const taskInput = text(positionals.task) ?? "";
      const task = aiTextTaskSchema.safeParse(taskInput);
      if (!task.success) {
        throw new Error(
          `Unknown task '${taskInput}'. Testable tasks: ${AI_TEXT_TASKS.join(", ")}`,
        );
      }
      return { task: task.data };
    },
    print: (result) =>
      result.ok
        ? `${result.displayName} (${result.durationMs}ms): ${result.text}`
        : `Failed after ${result.durationMs}ms: ${result.message}`,
    exitCode: (result, _input, json) => (json || result.ok ? 0 : 1),
  }),
  clientCommand({
    name: "cli.settings.general",
    kind: "write",
    description: "Set one Settings → General preference",
    door: {
      path: ["settings", "general"],
      summary: "Set a Settings → General preference",
      positionals: [{ name: "key" }, { name: "value" }],
      prepare: ({ positionals }) => ({
        key: text(positionals.key) ?? "",
        value: text(positionals.value) ?? "",
      }),
      async run({ key, value }, client) {
        const config = await currentConfig(client);
        return client.call(
          "system.generalSettings",
          updateGeneralSetting(config.generalSettings, key, value),
        );
      },
      print: (_result, { key }) => `${key} updated`,
    },
  }),
  publicCommand("system.generalSettings", {
    path: ["settings", "replay-onboarding"],
    summary: "Show the first-run setup guide again",
    async prepare(_values, client) {
      const config = await currentConfig(client);
      return { ...config.generalSettings, onboardingCompletedAt: null };
    },
    print: () => "The setup guide is showing again",
  }),
  clientCommand({
    name: "cli.settings.completed-turns",
    kind: "write",
    description:
      "Show or set how each provider's finished turns display; reads providers and settings, and writes settings when a display is given",
    door: {
      path: ["settings", "completed-turns"],
      summary:
        "Show or set whether each provider's finished turns collapse or stay flat (collapse, flat, or default)",
      positionals: [
        { name: "providerId", required: false },
        { name: "display", required: false },
      ],
      prepare: ({ positionals }) => ({
        providerId: text(positionals.providerId),
        display: text(positionals.display),
      }),
      async run(
        { providerId, display },
        client,
      ): Promise<
        | { kind: "list"; entries: ProviderCompletedTurnDisplayEntry[] }
        | { kind: "show"; entry: ProviderCompletedTurnDisplayEntry }
        | { kind: "set"; entry: ProviderCompletedTurnDisplayEntry }
      > {
        const [config, providers] = await Promise.all([
          currentConfig(client),
          client.call("system.providers", {}),
        ]);
        if (providerId === undefined) {
          return {
            kind: "list",
            entries: providers.map((provider) =>
              describeProviderCompletedTurnDisplay(
                config.generalSettings,
                provider,
              ),
            ),
          };
        }
        const provider = requireKnownProvider(providers, providerId);
        if (display === undefined) {
          return {
            kind: "show",
            entry: describeProviderCompletedTurnDisplay(
              config.generalSettings,
              provider,
            ),
          };
        }
        const updated = await client.call(
          "system.generalSettings",
          updateProviderCompletedTurnDisplay(
            config.generalSettings,
            provider.id,
            parseCompletedTurnDisplayInput(display),
          ),
        );
        return {
          kind: "set",
          entry: describeProviderCompletedTurnDisplay(updated, provider),
        };
      },
      json: (output) =>
        output.kind === "list" ? output.entries : output.entry,
      print(output) {
        if (output.kind === "list") {
          if (output.entries.length === 0) return "No providers available";
          printCompletedTurnDisplayTable(output.entries);
          return null;
        }
        if (output.kind === "show") {
          printCompletedTurnDisplayTable([output.entry]);
          return null;
        }
        const { entry } = output;
        return `${entry.providerId} finished turns: ${entry.completedTurnDisplay} (${
          entry.source === "setting" ? "setting" : "provider default"
        })`;
      },
    },
  }),
  publicCommand("system.uiPreferences", {
    path: ["settings", "ui", "list"],
    summary: "List every UI preference with its value and revision",
    print(result) {
      for (const key of UI_PREFERENCE_KEYS) {
        const entry = result.preferences[key];
        console.log(
          `${key}  ${JSON.stringify(entry.value)}  (revision ${entry.revision})`,
        );
        console.log(`  ${describeUiPreference(key)}`);
      }
      return null;
    },
  }),
  clientCommand({
    name: "cli.settings.ui.get",
    kind: "read",
    description: "Read one UI preference from the preference list",
    door: {
      path: ["settings", "ui", "get"],
      summary: "Show one UI preference",
      positionals: [{ name: "key" }],
      prepare: ({ positionals }) => ({
        key: requireUiPreferenceKey(text(positionals.key) ?? ""),
      }),
      async run({ key }, client) {
        const { preferences } = await client.call("system.uiPreferences", {});
        return { key, entry: preferences[key] };
      },
      json: ({ key, entry }) => ({ key, ...entry }),
      print: ({ entry }) => JSON.stringify(entry.value),
    },
  }),
  clientCommand({
    name: "cli.settings.ui.set",
    kind: "write",
    description:
      "Set a UI preference at its current revision, retrying once after a concurrent change",
    door: {
      path: ["settings", "ui", "set"],
      summary: "Set a UI preference; lists and null take JSON",
      positionals: [{ name: "key" }, { name: "value" }],
      prepare({ positionals }) {
        const key = requireUiPreferenceKey(text(positionals.key) ?? "");
        return {
          key,
          value: parseUiPreferenceInput(key, text(positionals.value) ?? ""),
        };
      },
      async run({ key, value }, client) {
        const write = async () => {
          const { preferences } = await client.call("system.uiPreferences", {});
          return client.call("system.updateUiPreference", {
            key,
            expectedRevision: preferences[key].revision,
            value,
          });
        };
        try {
          return await write();
        } catch (error) {
          if (!isUiPreferenceConflict(error)) throw error;
          return write();
        }
      },
      print: (_result, { key }) => `${key} updated`,
    },
  }),
  publicCommand("system.resetUiPreference", {
    path: ["settings", "ui", "reset"],
    summary: "Reset a UI preference to its default",
    positionals: [{ name: "key" }],
    prepare: ({ positionals }) => ({
      key: requireUiPreferenceKey(text(positionals.key) ?? ""),
    }),
    print: (_result, { key }) => `${key} reset`,
  }),
  clientCommand({
    name: "cli.settings.mobile-app",
    kind: "read",
    description:
      "Show the mobile app download links, and the public release details on request",
    door: {
      path: ["settings", "mobile-app"],
      summary: "Show iOS TestFlight and Android APK download links",
      options: [flag("--details", "Include available public release metadata")],
      prepare: ({ options }) => ({ details: options.details === true }),
      async run({ details }, client) {
        const links = client.sdk().system.mobileAppDownloads();
        if (!details) return { links, releases: null };
        return {
          links,
          releases: await client.call("system.mobileAppReleases", {}),
        };
      },
      json: ({ links, releases }) =>
        releases === null ? links : { downloads: links, releases },
      print({ links, releases }) {
        console.log(
          `iOS TestFlight: ${links.ios}\nAndroid APK: ${links.android}`,
        );
        if (releases === null) return null;
        console.log(
          releases.android
            ? `Android ${releases.android.version} (build ${releases.android.versionCode}) · Updated ${releases.android.updatedAt} · ${Math.ceil(releases.android.size / 1024 / 1024)} MB`
            : "Android release details are unavailable.",
        );
        console.log("iOS version and release date are shown in TestFlight.");
        return null;
      },
    },
  }),
  publicCommand("system.experiments", {
    path: ["settings", "experiment"],
    summary: "Set an experiment value",
    positionals: [{ name: "key" }, { name: "value" }],
    prepare: ({ positionals }) =>
      experimentUpdate(
        text(positionals.key) ?? "",
        text(positionals.value) ?? "",
      ),
    print: (_result, input) => `${Object.keys(input)[0]} updated`,
  }),
  publicCommand("system.generalSettings", {
    path: ["settings", "keyboard", "hints"],
    summary: "Show or hide held-modifier shortcut hints",
    positionals: [{ name: "value" }],
    async prepare({ positionals }, client) {
      const config = await currentConfig(client);
      return updateGeneralSetting(
        config.generalSettings,
        "showKeyboardHints",
        text(positionals.value) ?? "",
      );
    },
    print: () => "Keyboard hint visibility updated",
  }),
  publicCommand("system.config", {
    path: ["settings", "keyboard", "list"],
    summary: "List effective keybindings and overrides",
    json: (config) => ({
      bindings: config.keybindings,
      overrides: config.keybindingOverrides,
    }),
    print: (config) =>
      JSON.stringify(
        { bindings: config.keybindings, overrides: config.keybindingOverrides },
        null,
        2,
      ),
  }),
  publicCommand("system.keyboardSettings", {
    path: ["settings", "keyboard", "set"],
    summary: "Set a command shortcut; use 'disabled' to clear it",
    positionals: [{ name: "command" }, { name: "shortcut" }],
    options: [PLATFORM_OPTION],
    async prepare({ positionals, options }, client) {
      const platform = platformValue(options.platform);
      const command = keyboardCommandIdSchema.parse(text(positionals.command));
      const shortcut = text(positionals.shortcut) ?? "";
      const config = await currentConfig(client);
      const next = config.keybindingOverrides.filter(
        (item) => item.command !== command || item.platform !== platform,
      );
      next.push({
        command,
        ...(platform === undefined ? {} : { platform }),
        shortcut: shortcut === "disabled" ? null : parseShortcut(shortcut),
      });
      return { overrides: next };
    },
    print: (_result, { overrides }) =>
      `Shortcut for ${overrides.at(-1)?.command} updated`,
  }),
  clientCommand({
    name: "cli.settings.keyboard.reset",
    kind: "write",
    description:
      "Remove one command's shortcut override, or every override, from the keyboard settings",
    door: {
      path: ["settings", "keyboard", "reset"],
      summary: "Reset one command override or all keyboard overrides",
      positionals: [{ name: "command", required: false }],
      options: [PLATFORM_OPTION],
      prepare: ({ positionals, options }) => ({
        platform: platformValue(options.platform),
        commandInput: text(positionals.command),
      }),
      async run({ platform, commandInput }, client) {
        const config = await currentConfig(client);
        const command =
          commandInput === undefined
            ? undefined
            : keyboardCommandIdSchema.parse(commandInput);
        const next = config.keybindingOverrides.filter(
          (item) =>
            (command !== undefined && item.command !== command) ||
            (platform !== undefined && item.platform !== platform),
        );
        return client.call("system.keyboardSettings", { overrides: next });
      },
      print: (_result, { commandInput }) =>
        commandInput
          ? `Shortcut for ${commandInput} reset`
          : "Keyboard overrides reset",
    },
  }),
  publicCommand("system.usageLimits", {
    path: ["settings", "usage"],
    summary: "Show provider usage limits",
    options: [
      flag("--refresh", "Fetch fresh usage instead of a cached result"),
      flag(
        "--machine <id-or-name>",
        "Machine whose provider usage should be shown",
      ),
      flag("--host <id-or-name>", "Alias for --machine"),
    ],
    async prepare({ options }, client) {
      const machine = text(options.machine);
      const host = text(options.host);
      const target = resolveMachineTargetOption({
        ...(machine === undefined ? {} : { machine }),
        ...(host === undefined ? {} : { host }),
      });
      const hostId =
        target === undefined
          ? undefined
          : await resolveMachineHostId({ serverUrl: client.url, target });
      return {
        ...(hostId === undefined ? {} : { hostId }),
        ...(options.refresh === true ? { refresh: "true" as const } : {}),
      };
    },
    print: (result) => JSON.stringify(result, null, 2),
  }),
  publicCommand("system.version", {
    path: ["settings", "version"],
    summary: "Check the running and latest BB versions",
    options: [flag("--force", "Bypass the latest-version cache")],
    prepare: ({ options }) =>
      options.force === true ? { force: "true" as const } : {},
    print: (result) => JSON.stringify(result, null, 2),
  }),
  publicCommand("system.cliCommand", {
    path: ["settings", "cli-command", "show"],
    summary: "Show whether the bb CLI is installed for use outside bb",
    isDefault: true,
    print: (status) => describeCliCommandStatus(status),
  }),
  publicCommand("system.installCliCommand", {
    path: ["settings", "cli-command", "install"],
    summary: "Link the bb CLI into a folder on PATH",
    print: (status) => describeCliCommandStatus(status),
  }),
  publicCommand("system.removeCliCommand", {
    path: ["settings", "cli-command", "remove"],
    summary: "Take the bb CLI that bb installed off PATH",
    print: (status) =>
      status.installedPath === null
        ? "Removed the bb CLI from your PATH."
        : describeCliCommandStatus(status),
  }),
  publicCommand("system.reloadConfig", {
    path: ["settings", "reload"],
    summary: "Reload BB's managed configuration",
    print: () => "Configuration reloaded",
  }),
];

export function registerSettingsCommands(
  program: Command,
  getUrl: () => string,
): void {
  const deps = { getUrl };
  const settings = program
    .command("settings")
    .description("Inspect and update BB settings");
  mountCommands(program, settingsCommands.slice(0, 1), deps);
  settings
    .command("ai-services")
    .description(
      "Choose which plugin AI service writes thread titles, commit messages, and voice transcripts",
    );
  mountCommands(program, settingsCommands.slice(1, 7), deps);
  settings
    .command("ui")
    .description(
      "Manage server-synced UI preferences such as sidebar layout and navigation",
    );
  mountCommands(program, settingsCommands.slice(7, 13), deps);
  settings
    .command("keyboard")
    .description("Manage keyboard settings and shortcut overrides");
  mountCommands(program, settingsCommands.slice(13, 19), deps);
  settings
    .command("cli-command")
    .description(
      "Install the bb CLI for use outside bb, on the computer that runs the bb server",
    );
  mountCommands(program, settingsCommands.slice(19), deps);
}
