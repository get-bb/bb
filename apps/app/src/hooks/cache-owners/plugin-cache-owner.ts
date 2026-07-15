import type { QueryClient } from "@tanstack/react-query";
import {
  allPluginListQueryKeyPrefix,
  pluginSettingsViewQueryKey,
  type PluginSettingsView,
} from "../queries/plugin-settings-queries";
import {
  allPluginCatalogSearchQueryKeyPrefix,
  pluginCatalogStatusQueryKey,
  type PluginCatalogStatus,
} from "../queries/plugin-catalog-queries";

/**
 * Cache owner for plugin management data. The PUT /plugins/:id/settings
 * response is the refreshed settings view, so the mutation seeds it directly
 * instead of refetching; realtime `plugins-changed` invalidation (the
 * registry) covers every other writer.
 */
export function applyPluginSettingsView(args: {
  queryClient: QueryClient;
  pluginId: string;
  view: PluginSettingsView;
}): void {
  args.queryClient.setQueryData(
    pluginSettingsViewQueryKey(args.pluginId),
    args.view,
  );
}

/**
 * Refetch the installed-plugin list after an enable/disable POST. The
 * realtime `plugins-changed` broadcast covers other windows; this gives the
 * acting window an immediate refresh.
 */
export function invalidatePluginList(args: { queryClient: QueryClient }): void {
  void args.queryClient.invalidateQueries({
    queryKey: allPluginListQueryKeyPrefix(),
  });
}

/**
 * Store a catalog refresh response immediately so status text and errors do
 * not wait for another request.
 */
export function applyPluginCatalogStatus(args: {
  queryClient: QueryClient;
  status: PluginCatalogStatus;
}): void {
  args.queryClient.setQueryData(pluginCatalogStatusQueryKey(), args.status);
}

/**
 * Refetch catalog results after a successful refresh or install. Search rows
 * carry installed and compatibility state, so plugin lifecycle changes also
 * invalidate this prefix. Failed refreshes intentionally keep cached rows.
 */
export function invalidatePluginCatalogSearch(args: {
  queryClient: QueryClient;
}): void {
  void args.queryClient.invalidateQueries({
    queryKey: allPluginCatalogSearchQueryKeyPrefix(),
  });
}
