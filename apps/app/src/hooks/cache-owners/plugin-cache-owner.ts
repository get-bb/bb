import type { QueryClient } from "@tanstack/react-query";
import {
  allPluginListQueryKeyPrefix,
  pluginSettingsViewQueryKey,
  type PluginSettingsView,
} from "../queries/plugin-settings-queries";
import { marketplacesQueryKey } from "../queries/plugin-marketplace-queries";

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
export function invalidatePluginList(args: {
  queryClient: QueryClient;
}): void {
  void args.queryClient.invalidateQueries({
    queryKey: allPluginListQueryKeyPrefix(),
  });
}

/**
 * Refetch marketplace catalogs after add/refresh/remove. The realtime
 * `plugins-changed` broadcast covers other windows; this gives the acting
 * window an immediate refresh.
 */
export function invalidateMarketplaces(args: {
  queryClient: QueryClient;
}): void {
  void args.queryClient.invalidateQueries({
    queryKey: marketplacesQueryKey(),
  });
}
