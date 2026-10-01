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

export function catalogEntryDetailKey(
  entry: Pick<
    PluginCatalogSearchEntry,
    "pluginId" | "entryId" | "marketplace" | "conflictingInstallSource"
  >,
): string {
  return entry.conflictingInstallSource === null
    ? entry.pluginId
    : `${entry.marketplace}/${entry.entryId}`;
}

export function resolvePluginDetailKey<
  Plugin extends Pick<
    PluginListItem,
    "id" | "source" | "catalogEntryId" | "catalogMarketplaceName"
  >,
  Entry extends Pick<
    PluginCatalogSearchEntry,
    "pluginId" | "entryId" | "marketplace" | "source" | "installed"
  >,
>(
  detailKey: string,
  plugins: readonly Plugin[],
  entries: readonly Entry[],
  options?: { allowSourceFallback?: boolean },
): { plugin: Plugin | null; entry: Entry | null } {
  if (!detailKey.includes("/")) {
    const plugin = plugins.find((candidate) => candidate.id === detailKey);
    const entry =
      plugin === undefined
        ? entries.find((candidate) => candidate.pluginId === detailKey)
        : installedPluginCatalogEntry(plugin, entries, options);
    return { plugin: plugin ?? null, entry: entry ?? null };
  }
  const entry = entries.find(
    (candidate) =>
      `${candidate.marketplace}/${candidate.entryId}` === detailKey,
  );
  if (entry === undefined) return { plugin: null, entry: null };
  const plugin = entry.installed
    ? (plugins.find(
        (candidate) =>
          installedPluginCatalogEntry(candidate, [entry]) !== undefined,
      ) ?? plugins.find((candidate) => candidate.id === entry.pluginId))
    : undefined;
  return { plugin: plugin ?? null, entry };
}

export function catalogEntryInstallBlocker(
  entry: Pick<
    PluginCatalogSearchEntry,
    "pluginId" | "incompatibleReason" | "conflictingInstallSource"
  >,
): string | null {
  if (entry.incompatibleReason !== null) return entry.incompatibleReason;
  if (entry.conflictingInstallSource === null) return null;
  return `Another plugin with the ID “${entry.pluginId}” is installed from ${conflictingInstallLocation(entry.conflictingInstallSource)}. Remove it to install this one.`;
}

export function conflictingInstallLocation(source: string): string {
  return source.startsWith("path:") ? source.slice("path:".length) : source;
}
