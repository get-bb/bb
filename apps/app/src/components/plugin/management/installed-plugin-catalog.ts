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
  { allowSourceFallback = true }: { allowSourceFallback?: boolean } = {},
): Entry | undefined {
  if (plugin.source.startsWith("path:")) return undefined;
  if (
    plugin.source.startsWith("builtin:") &&
    plugin.catalogMarketplaceName === null
  ) {
    return entries.find(
      (entry) =>
        entry.pluginId === plugin.id &&
        entry.marketplace === "bb-official" &&
        entry.source === plugin.source &&
        (plugin.catalogEntryId === null ||
          entry.entryId === plugin.catalogEntryId),
    );
  }
  if (
    !allowSourceFallback &&
    (plugin.catalogEntryId === null || plugin.catalogMarketplaceName === null)
  ) {
    return undefined;
  }
  return entries.find(
    (entry) =>
      entry.pluginId === plugin.id &&
      (plugin.catalogEntryId === null ||
        entry.entryId === plugin.catalogEntryId) &&
      (plugin.catalogMarketplaceName === null
        ? entry.source === plugin.source
        : entry.marketplace === plugin.catalogMarketplaceName),
  );
}
