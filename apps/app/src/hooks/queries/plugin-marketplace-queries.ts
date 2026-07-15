import type {
  MarketplaceSearchResult,
  MarketplaceRemoveResponse,
  MarketplaceView,
  PluginApplyUpdateResult as SdkPluginApplyUpdateResult,
  PluginInstallMarketplaceRequest,
  PluginInstallRequest,
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

export type { PluginInstallRequest };

function isMarketplaceInstall(
  request: PluginInstallRequest,
): request is PluginInstallMarketplaceRequest {
  return "marketplace" in request;
}

export async function installPlugin(
  fetchImpl: FetchLike,
  request: PluginInstallRequest,
): Promise<void> {
  const plugins = createPluginsClient(fetchImpl);
  if (isMarketplaceInstall(request)) {
    await plugins.installFromMarketplace({
      marketplaceId: request.marketplace.marketplaceId,
      entryId: request.marketplace.entryId,
      ...(request.version === undefined ? {} : { version: request.version }),
    });
    return;
  }
  await plugins.install({ source: request.source });
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

export interface MarketplaceListItem {
  id: string;
  name: string;
  displayName: string;
  source: string;
  resolvedCommit: string | null;
  pluginCount: number;
  lastRefreshAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
}

function toMarketplaceListItem(data: MarketplaceView): MarketplaceListItem {
  return {
    id: data.id,
    name: data.name,
    displayName: data.displayName,
    source: data.source,
    resolvedCommit: data.resolvedCommit ?? null,
    pluginCount: data.pluginCount,
    lastRefreshAt: data.lastRefreshAt ?? null,
    lastAttemptAt: data.lastAttemptAt ?? null,
    lastError: data.lastError ?? null,
  };
}

export async function fetchMarketplaces(
  fetchImpl: FetchLike,
): Promise<MarketplaceListItem[]> {
  try {
    const marketplaces =
      await createPluginsClient(fetchImpl).marketplaces.list();
    return marketplaces.map(toMarketplaceListItem);
  } catch {
    return [];
  }
}

export function marketplacesQueryKey(): QueryKey {
  return ["marketplaces"];
}

export function useMarketplaces(options: { enabled: boolean }) {
  return useQuery({
    queryKey: marketplacesQueryKey(),
    queryFn: () => fetchMarketplaces(fetch),
    enabled: options.enabled,
    staleTime: 30_000,
  });
}

export async function addMarketplace(
  fetchImpl: FetchLike,
  args: { source: string; name?: string },
): Promise<MarketplaceListItem> {
  return toMarketplaceListItem(
    await createPluginsClient(fetchImpl).marketplaces.add(args),
  );
}

export async function refreshMarketplace(
  fetchImpl: FetchLike,
  marketplaceId: string,
): Promise<MarketplaceListItem> {
  return toMarketplaceListItem(
    await createPluginsClient(fetchImpl).marketplaces.refresh({
      marketplaceId,
    }),
  );
}

export type MarketplaceRemoveResult = MarketplaceRemoveResponse;

export async function removeMarketplace(
  fetchImpl: FetchLike,
  marketplaceId: string,
): Promise<MarketplaceRemoveResult> {
  return createPluginsClient(fetchImpl).marketplaces.remove({ marketplaceId });
}

export interface MarketplaceSearchEntry {
  marketplaceId: string;
  entryId: string;
  displayName: string;
  description: string;
  icon: string | null;
  category: string | null;
  source: string;
  installed: boolean;
  compatible: boolean;
  incompatibleReason: string | null;
}

function toMarketplaceSearchEntry(
  data: MarketplaceSearchResult,
): MarketplaceSearchEntry {
  return {
    marketplaceId: data.marketplaceId,
    entryId: data.entryId,
    displayName: data.displayName,
    description: data.description,
    icon: data.icon,
    category: data.category ?? null,
    source: data.source,
    installed: data.installed,
    compatible: data.compatible,
    incompatibleReason: data.incompatibleReason ?? null,
  };
}

export async function searchMarketplaces(
  fetchImpl: FetchLike,
  query: string,
): Promise<MarketplaceSearchEntry[]> {
  try {
    const results = await createPluginsClient(fetchImpl).marketplaces.search({
      query,
    });
    return results.map(toMarketplaceSearchEntry);
  } catch {
    return [];
  }
}

export function marketplaceSearchQueryKey(query: string): QueryKey {
  return ["marketplace-search", query];
}

export function allMarketplaceSearchQueryKeyPrefix(): QueryKey {
  return ["marketplace-search"];
}

export function useMarketplaceSearch(
  query: string,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: marketplaceSearchQueryKey(query),
    queryFn: () => searchMarketplaces(fetch, query),
    enabled: options.enabled,
    staleTime: 30_000,
  });
}
