import type { PluginListingRecord } from "@bb/server-contract";
import { pluginCatalogCategory } from "@bb/domain";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";

export interface PluginCollectionEntry {
  pluginId: string;
  runtime: PluginListItem | null;
  listing: PluginListingRecord | null;
  catalogEntry: PluginCatalogSearchEntry | null;
}

interface MergePluginCollectionArgs {
  plugins: readonly PluginListItem[];
  listings: readonly PluginListingRecord[];
  catalogEntries: readonly PluginCatalogSearchEntry[];
}

export function mergePluginCollection({
  plugins,
  listings,
  catalogEntries,
}: MergePluginCollectionArgs): PluginCollectionEntry[] {
  const entries = new Map<string, PluginCollectionEntry>();
  for (const runtime of plugins) {
    const candidates = catalogEntries.filter(
      (entry) =>
        entry.pluginId === runtime.id &&
        (runtime.catalogEntryId === null ||
          entry.entryId === runtime.catalogEntryId),
    );
    const catalogEntry =
      candidates.find((entry) => entry.source === runtime.source) ??
      (candidates.length === 1 ? (candidates[0] ?? null) : null);
    entries.set(runtime.id, {
      pluginId: runtime.id,
      runtime,
      catalogEntry,
      listing: null,
    });
  }
  for (const listing of listings) {
    const existing = entries.get(listing.pluginId);
    if (existing !== undefined) {
      entries.set(listing.pluginId, { ...existing, listing });
      continue;
    }
    const publishedEntryId =
      listing.lifecycle.status === "published"
        ? listing.lifecycle.entryId
        : null;
    const catalogEntry =
      publishedEntryId !== null
        ? (catalogEntries.find(
            (entry) =>
              entry.pluginId === listing.pluginId &&
              entry.entryId === publishedEntryId,
          ) ?? null)
        : null;
    entries.set(listing.pluginId, {
      pluginId: listing.pluginId,
      runtime: null,
      catalogEntry,
      listing,
    });
  }
  return [...entries.values()];
}

export function pluginCollectionName(entry: PluginCollectionEntry): string {
  return (
    entry.runtime?.name ??
    entry.listing?.entry.displayName ??
    entry.catalogEntry?.displayName ??
    entry.pluginId
  );
}

export function pluginCollectionCategory(entry: PluginCollectionEntry): {
  id: string;
  label: string;
} {
  const id =
    entry.catalogEntry?.categoryId ??
    entry.runtime?.categoryId ??
    entry.listing?.entry.category;
  return id === undefined
    ? { id: "uncategorized", label: "Uncategorized" }
    : {
        id,
        label:
          entry.catalogEntry?.category ??
          entry.runtime?.category ??
          pluginCatalogCategory(id)?.displayName ??
          id,
      };
}
