import type { Command } from "commander";
import { collectDeclaredSessionOptions, type AvailableModel } from "@bb/domain";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemProviderCatalogEntry,
  SystemProviderInfo,
} from "@bb/server-contract";
import {
  JSON_FLAG_DESCRIPTION,
  type CliDoorOption,
  flag,
} from "@bb/operations";
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

interface RoutingValues {
  machine?: string;
  host?: string;
  environment?: string;
}

type ProviderListOutput =
  | { all: true; catalog: SystemProviderCatalogEntry[] }
  | { all: false; providers: SystemProviderInfo[] };

const ROUTING_OPTIONS: readonly CliDoorOption[] = [
  flag("--machine <id-or-name>", "Machine whose providers should be used"),
  flag("--host <id-or-name>", "Alias for --machine"),
  flag(
    "--environment <id>",
    "Environment whose machine providers should be used",
  ),
];

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function routingValues(
  options: Readonly<Record<string, unknown>>,
): RoutingValues {
  const machine = text(options.machine);
  const host = text(options.host);
  const environment = text(options.environment);
  return {
    ...(machine === undefined ? {} : { machine }),
    ...(host === undefined ? {} : { host }),
    ...(environment === undefined ? {} : { environment }),
  };
}

function providerEnabledCommand(enabled: boolean) {
  return publicCommand("system.providerEnabled", {
    path: ["provider", enabled ? "enable" : "disable"],
    summary: enabled
      ? "Enable a provider and its supplying plugin if needed"
      : "Disable a provider without uninstalling its CLI or disabling its plugin",
    positionals: [{ name: "providerId", field: "id" }],
    fixed: { enabled },
    print: (_catalog, input) =>
      `${input.id} ${enabled ? "enabled" : "disabled"}`,
  });
}

export const providerCommands = [
  clientCommand({
    name: "cli.provider.list",
    kind: "read",
    description: "List the providers a machine offers, or the global catalog",
    door: {
      path: ["provider", "list"],
      summary: "List available providers",
      options: [
        ...ROUTING_OPTIONS,
        flag(
          "--all",
          "Include disabled providers and providers whose plugins are disabled",
        ),
      ],
      prepare({ options }) {
        const routing = routingValues(options);
        const all = options.all === true;
        if (all && (routing.machine || routing.host || routing.environment))
          throw new Error(
            "--all shows the global provider catalog; omit --machine, --host and --environment.",
          );
        return { all, routing };
      },
      async run({ all, routing }, client): Promise<ProviderListOutput> {
        if (all) {
          return {
            all: true,
            catalog: await client.call("system.providerCatalog", {}),
          };
        }
        return {
          all: false,
          providers: await client.call(
            "system.providers",
            await resolveMachineEnvironmentRouting(routing, client.url),
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
    },
  }),
  providerEnabledCommand(true),
  providerEnabledCommand(false),
  clientCommand({
    name: "cli.provider.models",
    kind: "read",
    description:
      "List a provider's models on a machine, environment or project checkout",
    door: {
      path: ["provider", "models"],
      summary: "List available models for a provider",
      positionals: [{ name: "providerId", required: false }],
      options: [
        ...ROUTING_OPTIONS,
        flag(
          "--project <id>",
          "Project whose checkout on the machine the provider reads its models and options from",
        ),
        flag("--json", JSON_FLAG_DESCRIPTION),
        flag(
          "--selected-model <model>",
          "Discover reasoning for this model and include it if selected-only",
        ),
      ],
      prepare({ positionals, options }) {
        const project = text(options.project);
        const routing = routingValues(options);
        if (project !== undefined && routing.environment !== undefined) {
          throw new Error(
            "Cannot combine --project with --environment; the environment already selects its workspace.",
          );
        }
        return {
          routing,
          project,
          providerId: text(positionals.providerId),
          selectedModel: text(options["selected-model"]),
        };
      },
      async run({ routing, project, providerId, selectedModel }, client) {
        const resolved = await resolveMachineEnvironmentRouting(
          routing,
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
