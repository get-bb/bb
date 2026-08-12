import type {
  InstalledPlugin,
  PluginApplyUpdateResult as SdkPluginApplyUpdateResult,
  PluginCatalogSearchResult as SdkPluginCatalogSearchResult,
  PluginSourceDetail as SdkPluginSourceDetail,
  PluginUpdateCheckEntry,
} from "@bb/server-contract";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { createPluginsClient } from "./plugin-client";
import { toEpochMs } from "./plugin-settings-queries";

type FetchLike = typeof fetch;

export interface PluginSourceDetail {
  requested: string;
  resolved: string;
  integrity: string | null;
  registry: string | null;
  engines: { bb: string | null; bbPluginSdk: string | null };
  installedAt: number | null;
  history: { version: string; activatedAt: number | null }[];
}

function toPluginSourceDetail(
  source: SdkPluginSourceDetail,
): PluginSourceDetail {
  return {
    requested: source.requested,
    resolved: source.resolved,
    integrity: source.integrity ?? null,
    registry: source.registry ?? null,
    engines: {
      bb: source.engines.bb ?? null,
      bbPluginSdk: source.engines.bbPluginSdk ?? null,
    },
    installedAt: toEpochMs(source.installedAt),
    history: source.history.map((entry) => ({
      version: entry.version,
      activatedAt: toEpochMs(entry.activatedAt),
    })),
  };
}

/** Null when the plugin is unknown or the server predates the route. */
export async function fetchPluginSource(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<PluginSourceDetail | null> {
  try {
    return toPluginSourceDetail(
      await createPluginsClient(fetchImpl).getSource({ pluginId }),
    );
  } catch {
    return null;
  }
}

export function pluginSourceQueryKey(pluginId: string): QueryKey {
  return ["plugin-source", pluginId];
}

export function allPluginSourceQueryKeyPrefix(): QueryKey {
  return ["plugin-source"];
}

export function usePluginSource(
  pluginId: string,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: pluginSourceQueryKey(pluginId),
    queryFn: () => fetchPluginSource(fetch, pluginId),
    enabled: options.enabled,
    staleTime: 30_000,
  });
}

export async function installPlugin(
  fetchImpl: FetchLike,
  source: string,
): Promise<InstalledPlugin> {
  return createPluginsClient(fetchImpl).install({ source });
}

export async function installCatalogPlugin(
  fetchImpl: FetchLike,
  args: { entryId: string },
): Promise<InstalledPlugin> {
  return createPluginsClient(fetchImpl).catalog.install(args);
}

export interface PluginResolvedVersion {
  version: string;
  display: string;
}

export type PluginUpdatesOutcome = PluginUpdateCheckEntry["outcome"];

export interface PluginUpdatesEntry {
  id: string;
  outcome: PluginUpdatesOutcome;
  devMode: boolean;
  installed: PluginResolvedVersion;
  candidate: PluginResolvedVersion | null;
  blocked: { version: string; reasons: string[] } | null;
  detail: string | null;
}

function toUpdatesEntry(data: PluginUpdateCheckEntry): PluginUpdatesEntry {
  return {
    id: data.id,
    outcome: data.outcome,
    devMode: data.devMode === true,
    installed: data.installed,
    candidate: data.candidate ?? null,
    blocked: data.blocked ?? null,
    detail: data.detail ?? null,
  };
}

export async function checkPluginUpdates(
  fetchImpl: FetchLike,
  args: { id?: string } = {},
): Promise<PluginUpdatesEntry[]> {
  const results = await createPluginsClient(fetchImpl).checkUpdates(
    args.id === undefined ? {} : { pluginId: args.id },
  );
  return results.map(toUpdatesEntry);
}

export interface PluginUpdateResult {
  applied: boolean;
  outcome: SdkPluginApplyUpdateResult["outcome"];
  from: PluginResolvedVersion;
  to: PluginResolvedVersion | null;
  detail: string | null;
}

export async function applyPluginUpdate(
  fetchImpl: FetchLike,
  pluginId: string,
): Promise<PluginUpdateResult> {
  const result = await createPluginsClient(fetchImpl).applyUpdate({ pluginId });
  return {
    applied: result.applied,
    outcome: result.outcome,
    from: result.from,
    to: result.to ?? null,
    detail: result.detail ?? null,
  };
}

export interface PluginCatalogSearchEntry {
  entryId: string;
  pluginId: string;
  displayName: string;
  description: string;
  icon: string | null;
  category: string;
  source: string;
  installed: boolean;
  compatible: boolean;
  incompatibleReason: string | null;
}

function toPluginCatalogSearchEntry(
  data: SdkPluginCatalogSearchResult,
): PluginCatalogSearchEntry {
  return {
    entryId: data.entryId,
    pluginId: data.pluginId,
    displayName: data.displayName,
    description: data.description,
    icon: data.icon,
    category: data.category,
    source: data.source,
    installed: data.installed,
    compatible: data.compatible,
    incompatibleReason: data.incompatibleReason ?? null,
  };
}

export async function searchPluginCatalog(
  fetchImpl: FetchLike,
  query: string,
): Promise<PluginCatalogSearchEntry[]> {
  const results = await createPluginsClient(fetchImpl).catalog.search({
    query,
  });
  return results.map(toPluginCatalogSearchEntry);
}

export function pluginCatalogSearchQueryKey(query: string): QueryKey {
  return ["plugin-catalog-search", query];
}

export function allPluginCatalogSearchQueryKeyPrefix(): QueryKey {
  return ["plugin-catalog-search"];
}

const PLUGIN_CATALOG_STALE_TIME_MS = 30 * 60_000;

export function usePluginCatalogSearch(
  query: string,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: pluginCatalogSearchQueryKey(query),
    queryFn: () => searchPluginCatalog(fetch, query),
    enabled: options.enabled,
    refetchOnWindowFocus: false,
    staleTime: PLUGIN_CATALOG_STALE_TIME_MS,
  });
}
