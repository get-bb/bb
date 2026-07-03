import type { QueryClient } from "@tanstack/react-query";
import {
  pluginSettingsViewQueryKey,
  type PluginSettingsView,
} from "../queries/plugin-settings-queries";

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
