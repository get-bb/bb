import { Command } from "commander";
import type { AvailableModel } from "@bb/domain";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemProviderInfo,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import { resolveMachineEnvironmentRouting } from "./machine.js";

interface ProviderListCommandOptions {
  environment?: string;
  host?: string;
  json?: boolean;
  all?: boolean;
  machine?: string;
}

interface ProviderModelsCommandOptions {
  environment?: string;
  host?: string;
  json?: boolean;
  machine?: string;
  selectedModel?: string;
}

interface IncludeSelectedOnlyModelArgs {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  selectedModel?: string;
}

function addProviderRoutingOptions(command: Command): Command {
  return command
    .option("--machine <id-or-name>", "Machine whose providers should be used")
    .option("--host <id-or-name>", "Alias for --machine")
    .option(
      "--environment <id>",
      "Environment whose machine providers should be used",
    );
}

export function registerProviderCommands(
  program: Command,
  getUrl: () => string,
): void {
  const provider = program
    .command("provider")
    .description("Manage providers and inspect their models");

  addProviderRoutingOptions(provider.command("list"))
    .description("List available providers")
    .option(
      "--all",
      "Include disabled providers and providers whose plugins are disabled",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ProviderListCommandOptions) => {
        const serverUrl = getUrl();
        const sdk = createCliBbSdk(serverUrl);
        if (opts.all) {
          if (opts.machine || opts.host || opts.environment)
            throw new Error(
              "--all shows the global provider catalog; omit --machine, --host and --environment.",
            );
          const catalog = await sdk.providers.catalog();
          if (outputJson(opts, catalog)) return;
          const rows = catalog.map((entry) => [
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
          return;
        }
        const providers = await sdk.providers.list(
          await resolveMachineEnvironmentRouting(opts, serverUrl),
        );
        if (outputJson(opts, providers)) return;
        if (providers.length === 0) {
          console.log("No providers available");
          return;
        }
        printProviderTable(providers);
      }),
    );

  for (const enabled of [true, false]) {
    provider
      .command(`${enabled ? "enable" : "disable"} <providerId>`)
      .description(
        enabled
          ? "Enable a provider and its supplying plugin if needed"
          : "Disable a provider without uninstalling its CLI or disabling its plugin",
      )
      .option("--json", "Print machine-readable JSON output")
      .action(
        action(async (providerId: string, opts: { json?: boolean }) => {
          const catalog = await createCliBbSdk(getUrl()).providers.setEnabled({
            providerId,
            enabled,
          });
          if (outputJson(opts, catalog)) return;
          console.log(`${providerId} ${enabled ? "enabled" : "disabled"}`);
        }),
      );
  }

  addProviderRoutingOptions(provider.command("models [providerId]"))
    .description("List available models for a provider")
    .option("--json", "Print machine-readable JSON output")
    .option(
      "--selected-model <model>",
      "Include a selected-only model if it matches",
    )
    .action(
      action(
        async (
          providerId: string | undefined,
          opts: ProviderModelsCommandOptions,
        ) => {
          const serverUrl = getUrl();
          const sdk = createCliBbSdk(serverUrl);
          const executionOptions = await sdk.providers.models({
            ...(await resolveMachineEnvironmentRouting(opts, serverUrl)),
            ...(providerId ? { providerId } : {}),
          });
          const models = includeSelectedOnlyModel({
            models: executionOptions.models,
            selectedOnlyModels: executionOptions.selectedOnlyModels,
            selectedModel: opts.selectedModel,
          });
          printModelLoadError(executionOptions.modelLoadError);
          if (outputJson(opts, models)) return;
          if (models.length === 0) {
            console.log("No models available");
            return;
          }
          printModelTable(models, providerId);
        },
      ),
    );
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
}
