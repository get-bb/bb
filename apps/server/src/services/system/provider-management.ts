import { getAppSettings, setAppSettings } from "@bb/db";
import type { SystemProviderCatalogEntry } from "@bb/server-contract";
import type { ServerAppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import type { PluginService } from "../plugins/plugin-service.js";

export function providerManagementCatalog(
  deps: Pick<ServerAppDeps, "providerRegistry">,
  plugins: Pick<PluginService, "list" | "providerCatalog">,
): SystemProviderCatalogEntry[] {
  const installed = new Map(
    plugins.list().map((plugin) => [plugin.id, plugin]),
  );
  const declared = new Map(
    plugins.providerCatalog().map((provider) => [provider.id, provider]),
  );
  for (const entry of deps.providerRegistry.list()) {
    declared.set(entry.info.id, {
      id: entry.info.id,
      displayName: entry.info.displayName,
      pluginId: entry.pluginId,
    });
  }
  return [...declared.values()].flatMap((entry) => {
    const plugin = installed.get(entry.pluginId);
    if (plugin === undefined) return [];
    const registration = deps.providerRegistry.get(entry.id);
    return [
      {
        ...entry,
        pluginName: plugin.name ?? plugin.id,
        pluginEnabled: plugin.enabled,
        enabled: deps.providerRegistry.isEnabled(entry.id),
        available: registration?.info.available ?? false,
        logoUrl: registration?.info.logoUrl ?? plugin.iconUrl,
        info: registration?.info ?? null,
      },
    ];
  });
}

export async function setProviderEnabled(
  deps: Pick<ServerAppDeps, "db" | "providerRegistry" | "hub">,
  plugins: Pick<PluginService, "list" | "providerCatalog" | "setEnabled">,
  id: string,
  enabled: boolean,
): Promise<SystemProviderCatalogEntry[]> {
  const provider = providerManagementCatalog(deps, plugins).find(
    (entry) => entry.id === id,
  );
  if (provider === undefined)
    throw new ApiError(404, "provider_not_found", `Unknown provider "${id}".`);
  if (enabled && !provider.pluginEnabled) {
    await plugins.setEnabled(provider.pluginId, true);
  }
  if (enabled) {
    if (deps.providerRegistry.get(id)?.info.available !== true) {
      throw new ApiError(
        409,
        "provider_unavailable",
        `Could not enable ${provider.displayName}. Check ${provider.pluginName} in Settings → Plugins.`,
      );
    }
  }
  const current = getAppSettings(deps.db);
  const providerEnabled = { ...current.providerEnabled, [id]: enabled };
  const defaultProviderId =
    !enabled && current.defaultProviderId === id
      ? null
      : current.defaultProviderId;
  setAppSettings(deps.db, { ...current, providerEnabled, defaultProviderId });
  deps.hub.notifySystem(["config-changed"]);
  return providerManagementCatalog(deps, plugins);
}
