import { PLUGIN_CATALOG_CATEGORIES, pluginCatalogCategory } from "@bb/domain";
import type { PluginCatalogCollection } from "@bb/server-contract";
import type {
  PluginCatalogSearchEntry,
  PluginCatalogSearchData,
} from "@/hooks/queries/plugin-catalog-queries";

export const UNCATEGORIZED_PLUGIN_CATEGORY_ID = "uncategorized";

export type PluginBrowseSort = "name" | "recently-added" | "most-installed";
export type PluginBrowseSortDirection = "asc" | "desc";

export interface PluginBrowseShelf {
  key: string;
  categoryId?: string;
  label: string;
  description?: string;
  entries: PluginCatalogSearchEntry[];
  kind: "collection" | "category" | "uncategorized";
}

export interface PluginBrowseCategoryOption {
  id: string;
  label: string;
  count: number;
}

export function pluginCategoryFilterOptions(
  entries: readonly Pick<PluginCatalogSearchEntry, "categoryId" | "category">[],
  selected: readonly string[],
): PluginBrowseCategoryOption[] {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();
  const unknownIds: string[] = [];
  for (const entry of entries) {
    const id = pluginCategoryFilterId(entry);
    if (id === UNCATEGORIZED_PLUGIN_CATEGORY_ID) continue;
    if (!labels.has(id)) {
      labels.set(id, entry.category ?? id);
      if (pluginCatalogCategory(id) === undefined) {
        unknownIds.push(id);
      }
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const id of selected) {
    if (id === UNCATEGORIZED_PLUGIN_CATEGORY_ID || labels.has(id)) continue;
    const category = pluginCatalogCategory(id);
    labels.set(id, category?.displayName ?? id);
    if (category === undefined) {
      unknownIds.push(id);
    }
  }
  const orderedIds = [
    ...PLUGIN_CATALOG_CATEGORIES.map((category) => category.id).filter((id) =>
      labels.has(id),
    ),
    ...unknownIds,
  ];
  return orderedIds.map((id) => ({
    id,
    label: labels.get(id) ?? id,
    count: counts.get(id) ?? 0,
  }));
}

function isCategorized(
  entry: Pick<PluginCatalogSearchEntry, "categoryId" | "category">,
): boolean {
  return entry.categoryId !== undefined && entry.category !== undefined;
}

function collectionEntries(
  entries: readonly PluginCatalogSearchEntry[],
  collection: PluginCatalogCollection,
): PluginCatalogSearchEntry[] {
  const rankByEntryId = new Map(
    collection.pluginIds.map((entryId, rank) => [entryId, rank]),
  );
  return entries
    .filter(
      (entry) =>
        rankByEntryId.has(entry.entryId) &&
        entry.collections.some((membership) => membership.id === collection.id),
    )
    .sort(
      (left, right) =>
        (rankByEntryId.get(left.entryId) ?? Number.MAX_SAFE_INTEGER) -
        (rankByEntryId.get(right.entryId) ?? Number.MAX_SAFE_INTEGER),
    );
}

export function pluginBrowseShelves({
  entries,
  collections,
}: PluginCatalogSearchData): PluginBrowseShelf[] {
  const shelves: PluginBrowseShelf[] = collections.flatMap((collection) => {
    const shelfEntries = collectionEntries(entries, collection);
    return shelfEntries.length === 0
      ? []
      : [
          {
            key: `collection:${collection.id}`,
            label: collection.displayName,
            entries: shelfEntries,
            kind: "collection" as const,
          },
        ];
  });
  const entriesByCategory = new Map<string, PluginCatalogSearchEntry[]>();
  const categoryLabels = new Map<string, string>();
  const unknownCategoryOrder: string[] = [];
  for (const entry of entries) {
    if (!isCategorized(entry)) continue;
    const categoryId = entry.categoryId;
    const categoryLabel = entry.category;
    if (categoryId === undefined || categoryLabel === undefined) continue;
    const categoryEntries = entriesByCategory.get(categoryId);
    if (categoryEntries === undefined) {
      entriesByCategory.set(categoryId, [entry]);
      categoryLabels.set(categoryId, categoryLabel);
      if (pluginCatalogCategory(categoryId) === undefined) {
        unknownCategoryOrder.push(categoryId);
      }
    } else {
      categoryEntries.push(entry);
    }
  }
  const categoryOrder = [
    ...PLUGIN_CATALOG_CATEGORIES.map((category) => category.id),
    ...unknownCategoryOrder,
  ];
  for (const categoryId of categoryOrder) {
    const shelfEntries = entriesByCategory.get(categoryId);
    if (shelfEntries === undefined || shelfEntries.length === 0) continue;
    const builtInCategory = pluginCatalogCategory(categoryId);
    shelves.push({
      key: `category:${categoryId}`,
      categoryId,
      label:
        builtInCategory?.displayName ??
        categoryLabels.get(categoryId) ??
        categoryId,
      ...(builtInCategory === undefined
        ? {}
        : { description: builtInCategory.description }),
      entries: shelfEntries,
      kind: "category",
    });
  }
  const uncategorizedEntries = entries.filter((entry) => !isCategorized(entry));
  if (uncategorizedEntries.length > 0) {
    shelves.push({
      key: "category:uncategorized",
      categoryId: UNCATEGORIZED_PLUGIN_CATEGORY_ID,
      label: "More plugins",
      entries: uncategorizedEntries,
      kind: "uncategorized",
    });
  }
  return shelves;
}

export function pluginCategoryFilterId(
  entry: Pick<PluginCatalogSearchEntry, "categoryId" | "category">,
): string {
  return isCategorized(entry)
    ? (entry.categoryId ?? UNCATEGORIZED_PLUGIN_CATEGORY_ID)
    : UNCATEGORIZED_PLUGIN_CATEGORY_ID;
}

function compareOptionalNumbers(
  left: number | undefined,
  right: number | undefined,
  direction: PluginBrowseSortDirection,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  const result = left - right;
  return direction === "asc" ? result : -result;
}

export function sortPluginEntries<
  Entry extends Pick<
    PluginCatalogSearchEntry,
    "displayName" | "entryId" | "publishedAt" | "installs"
  >,
>(
  entries: readonly Entry[],
  sort: PluginBrowseSort,
  direction: PluginBrowseSortDirection = "desc",
): Entry[] {
  return [...entries].sort((left, right) => {
    const sortResult =
      sort === "name"
        ? left.displayName.localeCompare(right.displayName) *
          (direction === "asc" ? 1 : -1)
        : sort === "recently-added"
          ? compareOptionalNumbers(
              left.publishedAt === undefined
                ? undefined
                : Date.parse(left.publishedAt),
              right.publishedAt === undefined
                ? undefined
                : Date.parse(right.publishedAt),
              direction,
            )
          : compareOptionalNumbers(
              left.installs ?? undefined,
              right.installs ?? undefined,
              direction,
            );
    if (sortResult !== 0) return sortResult;
    const nameResult = left.displayName.localeCompare(right.displayName);
    return nameResult || left.entryId.localeCompare(right.entryId);
  });
}
