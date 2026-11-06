import type { Command } from "commander";
import { collectDeclaredSessionOptions, type AvailableModel } from "@bb/domain";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemProviderCatalogEntry,
  SystemProviderInfo,
} from "@bb/server-contract";
import { JSON_FLAG_DESCRIPTION, arg, flag } from "../cli-door.js";
import {
  clientCommand,
  mountCommands,
  publicCommand,
} from "../operation-doors.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { resolveMachineEnvironmentRouting } from "./machine.js";

interface IncludeSelectedOnlyModelArgs {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  selectedModel?: string;
}

type ProviderListOutput =
  | { all: true; catalog: SystemProviderCatalogEntry[] }
  | { all: false; providers: SystemProviderInfo[] };

const ROUTING_OPTIONS = {
  machine: flag(
    "--machine <id-or-name>",
    "Machine whose providers should be used",
  ),
  host: flag("--host <id-or-name>", "Alias for --machine"),
  environment: flag(
    "--environment <id>",
    "Environment whose machine providers should be used",
  ),
};

function providerEnabledCommand(enabled: boolean) {
  return publicCommand("system.providerEnabled", {
    path: ["provider", enabled ? "enable" : "disable"],
    summary: enabled
      ? "Enable a provider and its supplying plugin if needed"
      : "Disable a provider without uninstalling its CLI or disabling its plugin",
    positionals: { id: arg("<providerId>") },
    fixed: { enabled },
    print: (_catalog, input) =>
      `${input.id} ${enabled ? "enabled" : "disabled"}`,
  });
}

export const providerCommands = [
  clientCommand({
    path: ["provider", "list"],
    summary: "List available providers",
    options: {
      ...ROUTING_OPTIONS,
      all: flag(
        "--all",
        "Include disabled providers and providers whose plugins are disabled",
      ),
    },
    async run({ options }, client): Promise<ProviderListOutput> {
      if (options.all) {
        if (options.machine || options.host || options.environment)
          throw new Error(
            "--all shows the global provider catalog; omit --machine, --host and --environment.",
          );
        return {
          all: true,
          catalog: await client.call("system.providerCatalog", {}),
        };
      }
      return {
        all: false,
        providers: await client.call(
          "system.providers",
          await resolveMachineEnvironmentRouting(options, client.url),
        ),
      };
    },
    json: (output) => (output.all ? output.catalog : output.providers),
    print(output) {
      if (output.all) {
        const rows = output.catalog.map((entry) => [
          entry.id,
          entry.displayName,
          !entry.pluginEnabled
            ? "Plugin disabled"
            : !entry.enabled
              ? "Disabled"
              : entry.available
                ? "Enabled"
                : "Unavailable",
        ]);
        printBorderlessTable(
          {
            head: ["ID", "Name", "Status"],
            colWidths: columnWidths(rows, [4, 4, 6]),
          },
          rows,
        );
        return null;
      }
      if (output.providers.length === 0) return "No providers available";
      printProviderTable(output.providers);
      return null;
    },
  }),
  providerEnabledCommand(true),
  providerEnabledCommand(false),
  clientCommand({
    path: ["provider", "models"],
    summary: "List available models for a provider",
    positionals: { providerId: arg("[providerId]") },
    options: {
      ...ROUTING_OPTIONS,
      project: flag(
        "--project <id>",
        "Project whose checkout on the machine the provider reads its models and options from",
      ),
      json: flag("--json", JSON_FLAG_DESCRIPTION),
      selectedModel: flag(
        "--selected-model <model>",
        "Discover reasoning for this model and include it if selected-only",
      ),
    },
    async run({ positionals: { providerId }, options }, client) {
      const { project, selectedModel } = options;
      if (project !== undefined && options.environment !== undefined) {
        throw new Error(
          "Cannot combine --project with --environment; the environment already selects its workspace.",
        );
      }
      const resolved = await resolveMachineEnvironmentRouting(
        options,
        client.url,
      );
      const executionOptions = await client.call("system.executionOptions", {
        ...(resolved.environmentId !== undefined || project === undefined
          ? resolved
          : { ...resolved, projectId: project }),
        ...(providerId ? { providerId } : {}),
        ...(selectedModel ? { selectedModel } : {}),
      });
      printModelLoadError(executionOptions.modelLoadError);
      return {
        providerId,
        models: includeSelectedOnlyModel({
          models: executionOptions.models,
          selectedOnlyModels: executionOptions.selectedOnlyModels,
          selectedModel,
        }),
      };
    },
    json: (output) => output.models,
    print({ models, providerId }) {
      if (models.length === 0) return "No models available";
      printModelTable(models, providerId);
      return null;
    },
  }),
];

export function registerProviderCommands(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("provider")
    .description("Manage providers and inspect their models");
  mountCommands(program, providerCommands, { getUrl });
}

function includeSelectedOnlyModel(
  args: IncludeSelectedOnlyModelArgs,
): AvailableModel[] {
  if (!args.selectedModel) {
    return args.models;
  }
  if (args.models.some((model) => model.model === args.selectedModel)) {
    return args.models;
  }
  const selectedOnlyModel = args.selectedOnlyModels.find(
    (model) => model.model === args.selectedModel,
  );
  return selectedOnlyModel ? [selectedOnlyModel, ...args.models] : args.models;
}

function printProviderTable(providers: SystemProviderInfo[]): void {
  const rows = providers.map((provider) => [provider.id, provider.displayName]);
  printBorderlessTable(
    {
      head: ["ID", "Name"],
      colWidths: columnWidths(rows, [4, 4]),
    },
    rows,
  );
}

function printModelLoadError(
  modelLoadError: SystemExecutionOptionsModelLoadError | null,
): void {
  if (modelLoadError === null) {
    return;
  }
  console.error(
    `Could not load models for ${modelLoadError.providerId} (${modelLoadError.code})`,
  );
  if (modelLoadError.detail !== null) {
    console.error(`  ${modelLoadError.detail}`);
  }
}

function printModelTable(models: AvailableModel[], providerId?: string): void {
  if (providerId) {
    console.log(`Models for ${providerId}:`);
  }

  const listsServiceTiers = models.some(
    (model) => model.supportedServiceTiers !== undefined,
  );
  const rows = models.map((model) => [
    model.model,
    model.displayName ?? model.model,
    model.isDefault ? "*" : "",
    ...(listsServiceTiers
      ? [
          model.supportedServiceTiers === undefined
            ? ""
            : model.supportedServiceTiers.length === 0
              ? "-"
              : model.supportedServiceTiers.map((tier) => tier.id).join(", "),
        ]
      : []),
  ]);
  printBorderlessTable(
    {
      head: [
        "Model",
        "Name",
        "Default",
        ...(listsServiceTiers ? ["Service tiers"] : []),
      ],
      colWidths: columnWidths(
        rows,
        listsServiceTiers ? [5, 4, 7, 13] : [5, 4, 7],
      ),
      trimTrailingWhitespace: true,
    },
    rows,
  );
  for (const line of formatDeclaredSessionOptions(models)) {
    console.log(line);
  }
}

export function formatDeclaredSessionOptions(
  models: readonly AvailableModel[],
): string[] {
  const options = collectDeclaredSessionOptions(models);
  if (options.length === 0) {
    return [];
  }
  return [
    "",
    "Options (set with bb thread spawn --option <id>=<value>):",
    ...options.map((option) =>
      option.type === "boolean"
        ? `  ${option.id} (${option.label}): true | false, default ${String(option.value)}`
        : `  ${option.id} (${option.label}): ${option.values
            .map((value) => value.id)
            .join(" | ")}, default ${option.value}`,
    ),
  ];
}
