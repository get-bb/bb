import type { QueryClient } from "@tanstack/react-query";
import {
  allPluginListQueryKeyPrefix,
  pluginSettingsViewQueryKey,
  type PluginSettingsView,
} from "../queries/plugin-settings-queries";
import { allPluginCatalogSearchQueryKeyPrefix } from "../queries/plugin-catalog-queries";

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
 * Refetch catalog results after an install. Search rows carry installed and
 * compatibility state, so plugin lifecycle changes also invalidate this
 * prefix.
 */
export function invalidatePluginCatalogSearch(args: {
  queryClient: QueryClient;
}): void {
  void args.queryClient.invalidateQueries({
    queryKey: allPluginCatalogSearchQueryKeyPrefix(),
  });
}
