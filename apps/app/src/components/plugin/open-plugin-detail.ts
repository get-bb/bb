import type { QueryClient } from "@tanstack/react-query";
import type { InstalledPlugin } from "@bb/server-contract";
import { getPluginDetailRoutePath } from "@/lib/route-paths";
import type { PluginCatalogSearchData } from "@/hooks/queries/plugin-catalog-queries";
import {
  allPluginCatalogSearchQueryKeyPrefix,
  pluginListQueryKey,
} from "@/hooks/queries/query-keys";
import { openPluginDetailsInWorkspace } from "./plugin-detail-opener";

export function cachedPluginDetailTitle(
  queryClient: QueryClient,
  pluginId: string,
): string {
  const installed = queryClient
    .getQueryData<InstalledPlugin[]>(pluginListQueryKey(true))
    ?.find((plugin) => plugin.id === pluginId);
  if (installed?.name) return installed.name;
  for (const [, data] of queryClient.getQueriesData<PluginCatalogSearchData>({
    queryKey: allPluginCatalogSearchQueryKeyPrefix(),
  })) {
    const entry = data?.entries.find(
      (candidate) => candidate.pluginId === pluginId,
    );
    if (entry !== undefined) return entry.displayName;
  }
  return pluginId;
}

export function openPluginDetail(args: {
  pluginId: string;
  queryClient: QueryClient;
  navigate: (path: string) => void;
}): boolean {
  const pluginId = args.pluginId.trim();
  if (pluginId.length === 0) return false;
  if (
    openPluginDetailsInWorkspace({
      pluginId,
      title: cachedPluginDetailTitle(args.queryClient, pluginId),
    })
  ) {
    return true;
  }
  args.navigate(getPluginDetailRoutePath({ pluginId }));
  return true;
}
