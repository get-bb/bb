import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

export function installedPluginCatalogEntry<
  Entry extends Pick<
    PluginCatalogSearchEntry,
    "pluginId" | "entryId" | "marketplace" | "source"
  >,
>(
  plugin: Pick<
    PluginListItem,
    "id" | "source" | "catalogEntryId" | "catalogMarketplaceName"
  >,
  entries: readonly Entry[],
): Entry | undefined {
  if (plugin.source.startsWith("path:")) return undefined;
  return entries.find(
    (entry) =>
      entry.pluginId === plugin.id &&
      (plugin.catalogEntryId === null ||
        entry.entryId === plugin.catalogEntryId) &&
      (plugin.catalogMarketplaceName === undefined
        ? entry.source === plugin.source
        : entry.marketplace === plugin.catalogMarketplaceName),
  );
}
