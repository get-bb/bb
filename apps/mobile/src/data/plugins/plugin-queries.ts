import type {
  InstalledPlugin,
  PluginCatalogInstallPlan,
  PluginCatalogSearchResult,
  PluginMarketplace,
  PluginSettingsResponse,
  PluginUpdateCheckEntry,
} from "@bb/server-contract";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  pluginCatalogInstallPlanQueryKey,
  pluginCatalogSearchQueryKey,
  pluginLogsQueryKey,
  pluginMarketplacesQueryKey,
  pluginSettingsQueryKey,
  pluginsQueryKey,
  pluginUpdatesQueryKey,
} from "@/lib/query/query-keys";
import { requireEnabledQueryArg } from "../shared/query-helpers";
import {
  EXPENSIVE_MANUAL_QUERY_POLICY,
  FOCUS_OWNED_LIVE_QUERY_POLICY,
} from "../shared/query-policies";
import { useSystemRealtimeSubscription } from "../shared/use-realtime-subscription";
import { fetchPluginLogs, PLUGIN_LOGS_DEFAULT_TAIL } from "./plugin-logs";

interface QueryOptions {
  enabled?: boolean;
}

/**
 * `GET /plugins`: every installed plugin with status / enabled / update
 * state. Kept live through the `system` subscription (`plugins-changed`).
 */
export function usePluginList(options?: QueryOptions) {
  const { sdk } = useProfileClient();
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  return useQuery<InstalledPlugin[]>({
    queryKey: pluginsQueryKey(),
    queryFn: async ({ signal }) => (await sdk.plugins.list({ signal })).plugins,
    enabled,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });
}

/** One installed plugin out of the list query (null once loaded and absent). */
export function usePlugin(pluginId: string | null, options?: QueryOptions) {
  const list = usePluginList(options);
  const plugin = useMemo(
    () =>
      pluginId === null
        ? null
        : (list.data?.find((entry) => entry.id === pluginId) ?? null),
    [list.data, pluginId],
  );
  return { ...list, plugin };
}

/**
 * `GET /plugins/:id/settings`: the descriptor schema + stored values. Only
 * exists once the plugin's factory ran (running / needs-configuration /
 * degraded); callers gate `enabled` on that.
 */
export function usePluginSettings(
  pluginId: string | null,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && pluginId !== null;
  return useQuery<PluginSettingsResponse>({
    queryKey: pluginSettingsQueryKey(pluginId ?? ""),
    queryFn: ({ signal }) =>
      sdk.plugins.getSettings({
        pluginId: requireEnabledQueryArg({
          value: pluginId,
          hookName: "usePluginSettings",
          argName: "pluginId",
        }),
        signal,
      }),
    enabled,
    staleTime: 30_000,
  });
}

/** `GET /plugins/updates`: the last update-check result per plugin. */
export function usePluginUpdates(options?: QueryOptions) {
  const { sdk } = useProfileClient();
  return useQuery<PluginUpdateCheckEntry[]>({
    queryKey: pluginUpdatesQueryKey(),
    queryFn: ({ signal }) => sdk.plugins.listUpdateResults({ signal }),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    ...EXPENSIVE_MANUAL_QUERY_POLICY,
  });
}

export interface UsePluginLogsArgs extends QueryOptions {
  pluginId: string | null;
  tail?: number;
}

/** `GET /plugins/:id/logs?tail=`: the plugin host's log tail (plain lines). */
export function usePluginLogs({ pluginId, tail, enabled }: UsePluginLogsArgs) {
  const { fetch: profileFetch, serverUrl } = useProfileClient();
  const lines = tail ?? PLUGIN_LOGS_DEFAULT_TAIL;
  return useQuery<string[]>({
    queryKey: pluginLogsQueryKey(pluginId ?? "", lines),
    queryFn: ({ signal }) =>
      fetchPluginLogs(
        profileFetch,
        serverUrl,
        requireEnabledQueryArg({
          value: pluginId,
          hookName: "usePluginLogs",
          argName: "pluginId",
        }),
        lines,
        signal,
      ),
    enabled: (enabled ?? true) && pluginId !== null,
    staleTime: 5_000,
    ...EXPENSIVE_MANUAL_QUERY_POLICY,
  });
}

/**
 * `GET /plugin-catalog/search?q=`: every catalog entry across marketplaces
 * matching the query (empty query lists everything). Rows carry
 * `installed` / `compatible`; `plugins-changed` refreshes them.
 */
export function usePluginCatalogSearch(query: string, options?: QueryOptions) {
  const { sdk } = useProfileClient();
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  return useQuery<PluginCatalogSearchResult[]>({
    queryKey: pluginCatalogSearchQueryKey(query.trim()),
    queryFn: ({ signal }) =>
      sdk.plugins.catalog.search({ query: query.trim(), signal }),
    enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export interface CatalogInstallPlanArgs {
  entryId: string;
  marketplace?: string;
}

/**
 * `GET /plugin-catalog/install-plan`: the true resolved source (tag, commit,
 * npm version + integrity) before a third-party install is confirmed. Never
 * served from cache: a git range resolves to a different commit over time.
 */
export function usePluginCatalogInstallPlan(
  args: CatalogInstallPlanArgs | null,
) {
  const { sdk } = useProfileClient();
  return useQuery<PluginCatalogInstallPlan>({
    queryKey: pluginCatalogInstallPlanQueryKey(
      args?.entryId ?? "",
      args?.marketplace ?? null,
    ),
    queryFn: ({ signal }) =>
      sdk.plugins.catalog.installPlan({
        entryId: requireEnabledQueryArg({
          value: args?.entryId,
          hookName: "usePluginCatalogInstallPlan",
          argName: "entryId",
        }),
        marketplace: args?.marketplace,
        signal,
      }),
    enabled: args !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** `GET /marketplaces`: the registered plugin marketplaces. */
export function usePluginMarketplaces(options?: QueryOptions) {
  const { sdk } = useProfileClient();
  return useQuery<PluginMarketplace[]>({
    queryKey: pluginMarketplacesQueryKey(),
    queryFn: ({ signal }) => sdk.plugins.marketplaces.list({ signal }),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}
