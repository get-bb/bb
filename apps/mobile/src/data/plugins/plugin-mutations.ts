import type { JsonValue } from "@bb/domain";
import type {
  InstalledPlugin,
  PluginApplyUpdateResult,
  PluginCatalogResolvedSource,
  PluginMarketplace,
  PluginMarketplaceRefreshResult,
  PluginSettingsResponse,
  PluginUpdateCheckEntry,
} from "@bb/server-contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  allPluginCatalogSearchQueryKeyPrefix,
  allPluginSettingsQueryKeyPrefix,
  allProjectSkillsQueryKeyPrefix,
  pluginContributionsQueryKey,
  pluginLogsQueryKeyPrefix,
  pluginMarketplacesQueryKey,
  pluginSettingsQueryKey,
  pluginsQueryKey,
  pluginUpdatesQueryKey,
} from "@/lib/query/query-keys";

/**
 * Plugin management mutations (mirror of the web's plugin-cache-owner +
 * the mutations in ToolsView / PluginDetail / AddPluginDialog /
 * MarketplacesSettingsSection). Every mutation writes the returned plugin
 * into the list cache where the server returns one, then invalidates the
 * list so a `plugins-changed` race cannot leave it stale. Errors go through
 * the profile QueryClient's global toast via `meta.errorMessage`.
 */

function writeInstalledPlugin(
  queryClient: QueryClient,
  plugin: InstalledPlugin,
): void {
  queryClient.setQueryData<InstalledPlugin[]>(pluginsQueryKey(), (current) => {
    if (current === undefined) return current;
    const index = current.findIndex((entry) => entry.id === plugin.id);
    if (index < 0) return [...current, plugin];
    const next = [...current];
    next[index] = plugin;
    return next;
  });
}

function removeInstalledPlugin(
  queryClient: QueryClient,
  pluginId: string,
): void {
  queryClient.setQueryData<InstalledPlugin[]>(pluginsQueryKey(), (current) =>
    current?.filter((entry) => entry.id !== pluginId),
  );
}

/** Everything that changes when a plugin is (un)installed, reloaded, or toggled. */
function invalidatePluginRoster(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: pluginsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: pluginUpdatesQueryKey() });
  void queryClient.invalidateQueries({
    queryKey: allPluginSettingsQueryKeyPrefix(),
  });
  void queryClient.invalidateQueries({
    queryKey: allPluginCatalogSearchQueryKeyPrefix(),
  });
  void queryClient.invalidateQueries({
    queryKey: pluginContributionsQueryKey(),
  });
  void queryClient.invalidateQueries({
    queryKey: allProjectSkillsQueryKeyPrefix(),
  });
}

export interface SetPluginEnabledArgs {
  pluginId: string;
  enabled: boolean;
}

/** `POST /plugins/:id/enable|disable`. */
export function useSetPluginEnabled() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<InstalledPlugin, Error, SetPluginEnabledArgs>({
    meta: { errorMessage: "Failed to change the plugin state" },
    mutationFn: ({ pluginId, enabled }) =>
      enabled
        ? sdk.plugins.enable({ pluginId })
        : sdk.plugins.disable({ pluginId }),
    onSuccess: (plugin) => {
      writeInstalledPlugin(queryClient, plugin);
      invalidatePluginRoster(queryClient);
    },
  });
}

export interface UpdatePluginSettingsArgs {
  pluginId: string;
  values: Record<string, JsonValue>;
}

/** `PUT /plugins/:id/settings` (only the changed keys; see `pluginSettingsChanges`). */
export function useUpdatePluginSettings() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<PluginSettingsResponse, Error, UpdatePluginSettingsArgs>({
    meta: { errorMessage: "Saving plugin settings failed" },
    mutationFn: ({ pluginId, values }) =>
      sdk.plugins.updateSettings({ pluginId, values }),
    onSuccess: (view, { pluginId }) => {
      queryClient.setQueryData(pluginSettingsQueryKey(pluginId), view);
      // A settings write can flip needs-configuration → running.
      void queryClient.invalidateQueries({ queryKey: pluginsQueryKey() });
    },
  });
}

export interface CheckPluginUpdatesArgs {
  /** One plugin; omitted checks every plugin. */
  pluginId?: string;
}

/** `POST /plugins/updates/check`. */
export function useCheckPluginUpdates() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<PluginUpdateCheckEntry[], Error, CheckPluginUpdatesArgs>({
    meta: { errorMessage: "Checking for plugin updates failed" },
    mutationFn: ({ pluginId }) => sdk.plugins.checkUpdates({ pluginId }),
    onSuccess: (results, { pluginId }) => {
      queryClient.setQueryData<PluginUpdateCheckEntry[]>(
        pluginUpdatesQueryKey(),
        (current) => {
          if (pluginId === undefined || current === undefined) return results;
          const others = current.filter((entry) => entry.id !== pluginId);
          return [...others, ...results];
        },
      );
      // updateState on the list rows follows the check.
      void queryClient.invalidateQueries({ queryKey: pluginsQueryKey() });
    },
  });
}

export interface ApplyPluginUpdateArgs {
  pluginId: string;
}

/** `POST /plugins/:id/update`. */
export function useApplyPluginUpdate() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<PluginApplyUpdateResult, Error, ApplyPluginUpdateArgs>({
    meta: { errorMessage: "Updating the plugin failed" },
    mutationFn: ({ pluginId }) => sdk.plugins.applyUpdate({ pluginId }),
    onSuccess: (_result, { pluginId }) => {
      invalidatePluginRoster(queryClient);
      void queryClient.invalidateQueries({
        queryKey: pluginLogsQueryKeyPrefix(pluginId),
      });
    },
  });
}

export interface RemovePluginArgs {
  pluginId: string;
}

/** `DELETE /plugins/:id`. */
export function useRemovePlugin() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, RemovePluginArgs>({
    meta: { errorMessage: "Removing the plugin failed" },
    mutationFn: async ({ pluginId }) => {
      await sdk.plugins.remove({ pluginId });
    },
    onSuccess: (_result, { pluginId }) => {
      removeInstalledPlugin(queryClient, pluginId);
      queryClient.removeQueries({ queryKey: pluginSettingsQueryKey(pluginId) });
      queryClient.removeQueries({
        queryKey: pluginLogsQueryKeyPrefix(pluginId),
      });
      invalidatePluginRoster(queryClient);
    },
  });
}

export interface ReloadPluginsArgs {
  /** One plugin; omitted reloads every plugin. */
  pluginId?: string;
}

/** `POST /plugins/reload[?id=]`. */
export function useReloadPlugins() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<InstalledPlugin[], Error, ReloadPluginsArgs>({
    meta: { errorMessage: "Reloading plugins failed" },
    mutationFn: async ({ pluginId }) =>
      (await sdk.plugins.reload({ pluginId })).plugins,
    onSuccess: (plugins, { pluginId }) => {
      if (pluginId === undefined) {
        queryClient.setQueryData(pluginsQueryKey(), plugins);
      } else {
        for (const plugin of plugins) writeInstalledPlugin(queryClient, plugin);
      }
      invalidatePluginRoster(queryClient);
    },
  });
}

export type InstallPluginArgs =
  | { kind: "direct"; source: string }
  | {
      kind: "catalog";
      entryId: string;
      marketplace: string;
      /** The resolved source the user confirmed (third-party listings). */
      confirmedSource?: PluginCatalogResolvedSource;
    };

/** `POST /plugins/install` or `POST /plugin-catalog/install`. */
export function useInstallPlugin() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<InstalledPlugin, Error, InstallPluginArgs>({
    meta: { errorMessage: "Installing the plugin failed" },
    mutationFn: (args) =>
      args.kind === "direct"
        ? sdk.plugins.install({ source: args.source })
        : sdk.plugins.catalog.install({
            entryId: args.entryId,
            marketplace: args.marketplace,
            ...(args.confirmedSource === undefined
              ? {}
              : { confirmedSource: args.confirmedSource }),
          }),
    onSuccess: (plugin) => {
      writeInstalledPlugin(queryClient, plugin);
      invalidatePluginRoster(queryClient);
    },
  });
}

// --- Marketplaces -------------------------------------------------------------

function invalidateMarketplaces(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    queryKey: pluginMarketplacesQueryKey(),
  });
  void queryClient.invalidateQueries({
    queryKey: allPluginCatalogSearchQueryKeyPrefix(),
  });
}

export interface AddMarketplaceArgs {
  source: string;
}

/** `POST /marketplaces` (installs nothing). */
export function useAddMarketplace() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<PluginMarketplace, Error, AddMarketplaceArgs>({
    meta: { errorMessage: "Adding the marketplace failed" },
    mutationFn: ({ source }) => sdk.plugins.marketplaces.add({ source }),
    onSuccess: () => invalidateMarketplaces(queryClient),
  });
}

export interface RefreshMarketplacesArgs {
  /** One marketplace; omitted refreshes every one of them. */
  name?: string;
}

/** `POST /marketplaces/refresh`; a failed refresh keeps the last-known-good catalog. */
export function useRefreshMarketplaces() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    PluginMarketplaceRefreshResult[],
    Error,
    RefreshMarketplacesArgs
  >({
    meta: { errorMessage: "Refreshing the marketplace failed" },
    mutationFn: ({ name }) => sdk.plugins.marketplaces.refresh({ name }),
    onSuccess: () => invalidateMarketplaces(queryClient),
  });
}

export interface RemoveMarketplaceArgs {
  name: string;
}

/** `DELETE /marketplaces/:name` (uninstalls nothing; catalog installs become direct). */
export function useRemoveMarketplace() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    { convertedPluginIds: string[] },
    Error,
    RemoveMarketplaceArgs
  >({
    meta: { errorMessage: "Removing the marketplace failed" },
    mutationFn: ({ name }) => sdk.plugins.marketplaces.remove({ name }),
    onSuccess: () => {
      invalidateMarketplaces(queryClient);
      // Provenance labels on installed rows change (catalog → direct).
      void queryClient.invalidateQueries({ queryKey: pluginsQueryKey() });
    },
  });
}
