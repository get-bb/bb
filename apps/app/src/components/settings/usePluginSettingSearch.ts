import { useQueries } from "@tanstack/react-query";
import { pluginSettingsViewQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import type { PluginSettingsEntry } from "./plugin-settings-entries";
import type { PluginSettingSearchEntry } from "./settings-search";

interface UsePluginSettingSearchArgs {
  enabled: boolean;
  pluginEntries: readonly PluginSettingsEntry[];
}

interface PluginSettingSearchState {
  entries: readonly PluginSettingSearchEntry[];
  isLoading: boolean;
}

export function usePluginSettingSearch({
  enabled,
  pluginEntries,
}: UsePluginSettingSearchArgs): PluginSettingSearchState {
  const pluginIds = pluginEntries
    .filter((entry) => entry.hasSettingsForm)
    .map((entry) => entry.id);

  return useQueries({
    queries: pluginIds.map((pluginId) => ({
      ...pluginSettingsViewQueryOptions(pluginId),
      enabled,
    })),
    combine: (results) => ({
      entries: results.flatMap((result, index) => {
        const pluginId = pluginIds[index];
        if (pluginId === undefined) return [];
        return Object.entries(result.data?.schema ?? {}).map(
          ([key, descriptor]) => ({
            description: descriptor.description ?? null,
            key,
            label: descriptor.label,
            pluginId,
          }),
        );
      }),
      isLoading: results.some((result) => result.isLoading),
    }),
  });
}
