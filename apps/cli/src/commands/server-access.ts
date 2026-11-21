import type { Command } from "commander";
import type { ServerAccessStatus } from "@bb/server-contract";
import { action, CliExitError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "../command-result.js";
import { columnWidths, printBorderlessTable } from "../table.js";

interface JsonCommandOptions {
  json?: boolean;
}

type ServerAccessProvider = ServerAccessStatus["providers"][number];

function providerStatus(provider: ServerAccessProvider): string {
  if (!provider.enabled) return "off";
  return provider.availability.status === "available"
    ? "ready"
    : provider.availability.message;
}

function printServerAccess(access: ServerAccessStatus): void {
  const rows = access.providers.map((provider, index) => [
    String(index + 1),
    provider.id,
    provider.displayName,
    provider.routeKind,
    providerStatus(provider),
    provider.urls.join(", "),
  ]);
  printBorderlessTable(
    {
      head: ["#", "ID", "Route", "Kind", "Status", "Address"],
      colWidths: columnWidths(rows, [1, 2, 5, 4, 6, 7]),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}

function requireKnownProviders(
  access: ServerAccessStatus,
  providerIds: readonly string[],
): void {
  const known = new Set(access.providers.map((provider) => provider.id));
  const unknown = providerIds.filter((providerId) => !known.has(providerId));
  if (unknown.length > 0) {
    throw new CliExitError(
      `Unknown route ${unknown.join(", ")}. Run "bb server access list" for the available IDs.`,
      1,
    );
  }
}

export function registerServerAccessCommands(
  server: Command,
  getUrl: () => string,
): void {
  const access = server
    .command("access")
    .description(
      "List, turn on or off, and order the routes devices use to reach this server",
    );

  access
    .command("list")
    .description("List routes in order with their status and address")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonCommandOptions) => {
        const config = await createCliBbSdk(getUrl()).system.config();
        if (
          outputJson(opts, {
            serverId: config.serverId,
            routes: config.routes,
            serverAccess: config.serverAccess,
          })
        )
          return;
        console.log(`Server ID: ${config.serverId}`);
        printServerAccess(config.serverAccess);
      }),
    );

  for (const enabled of [true, false]) {
    access
      .command(`${enabled ? "enable" : "disable"} <route-id>`)
      .description(
        enabled
          ? "Turn a route on (local-network starts listening on this computer's LAN addresses)"
          : "Turn a route off so machines and apps stop using it",
      )
      .option("--json", "Print machine-readable JSON output")
      .action(
        action(async (providerId: string, opts: JsonCommandOptions) => {
          const sdk = createCliBbSdk(getUrl());
          const config = await sdk.system.config();
          requireKnownProviders(config.serverAccess, [providerId]);
          const disabled = new Set(
            config.generalSettings.disabledServerAccessProviderIds,
          );
          if (enabled) disabled.delete(providerId);
          else disabled.add(providerId);
          await sdk.system.updateGeneralSettings({
            ...config.generalSettings,
            disabledServerAccessProviderIds: [...disabled],
          });
          const updated = await sdk.system.config();
          if (outputJson(opts, updated.serverAccess)) return;
          printServerAccess(updated.serverAccess);
        }),
      );
  }

  access
    .command("order <route-ids...>")
    .description(
      "Put routes first in this order; unlisted routes keep their default rank after them",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (providerIds: string[], opts: JsonCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const config = await sdk.system.config();
        requireKnownProviders(config.serverAccess, providerIds);
        await sdk.system.updateGeneralSettings({
          ...config.generalSettings,
          serverAccessOrder: [...new Set(providerIds)],
        });
        const updated = await sdk.system.config();
        if (outputJson(opts, updated.serverAccess)) return;
        printServerAccess(updated.serverAccess);
      }),
    );
}
