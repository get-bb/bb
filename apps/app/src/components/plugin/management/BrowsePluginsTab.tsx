import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { PLUGIN_CATALOG_CATEGORIES, pluginCatalogCategory } from "@bb/domain";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  ResourceBrowseGrid,
  ResourceCollectionViewport,
  ResourceListState,
  ResourceShelfAction,
} from "@bb/shared-ui/resource-list";
import { BrowseArchetypeCards } from "@/components/plugin/browse-hero/BrowseArchetypeCards";
import { BrowseHeroCarousel } from "@/components/plugin/browse-hero/BrowseHeroCarousel";
import { nextComposerRequestNonce } from "@/components/plugin/browse-hero/browse-hero-archetypes";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import type { AddPluginInitial } from "./AddPluginDialog";
import { PluginCard, PluginCardAuthor } from "./PluginCard";
import { PluginCatalogInstallControl } from "./PluginCatalogInstallControl";
import { PluginCollectionToolbar } from "./PluginCollectionToolbar";
import { OpenPluginGuideButton } from "./OpenPluginGuideButton";
import {
  pluginBrowseSort,
  pluginBrowseSortDirection,
  type PluginBrowseCategoryOption,
} from "./PluginBrowseControls";
import {
  UNCATEGORIZED_PLUGIN_CATEGORY_ID,
  pluginBrowseShelves,
  pluginCategoryFilterId,
  sortPluginEntries,
  type PluginBrowseShelf,
} from "./plugin-browse-discovery";
import {
  CatalogEntryIconChip,
  formatPluginInstallCount,
  PluginCategoryLabel,
  pluginCatalogCategoryMutedAccentStyle,
  pluginCategoryDisplayName,
} from "./plugin-ui";

const SHELF_ENTRY_LIMIT = 6;

export function BrowsePluginsTab({
  onInstall,
  onOpenPlugin,
  onInstallFromSource,
  onUninstall,
}: {
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
  onInstallFromSource: () => void;
  onUninstall?: (pluginId: string) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("query") ?? "";
  const creationViewActive = searchParams.get("view") === "create";
  const selectedCategories = searchParams.getAll("category");
  const requestedSort = pluginBrowseSort(searchParams.get("sort"));
  const sortDirection =
    pluginBrowseSortDirection(searchParams.get("direction")) ?? "desc";
  const [heroRequest, setHeroRequest] = useState<{
    nonce: number;
    seed?: string;
    close?: boolean;
  } | null>(() =>
    creationViewActive ? { nonce: nextComposerRequestNonce() } : null,
  );
  const [requestedCreationView, setRequestedCreationView] =
    useState(creationViewActive);
  const [composing, setComposing] = useState(false);
  const activeShelfKey = searchParams.get("shelf");
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const searchQuery = usePluginCatalogSearch(debouncedQuery, { enabled: true });
  const catalog = searchQuery.data ?? { entries: [], collections: [] };
  const entries = useMemo(
    () => catalog.entries.filter((entry) => entry.compatible),
    [catalog.entries],
  );
  const installsKnown = entries.some((entry) => entry.installs !== null);
  const sort =
    requestedSort === "most-installed" && !installsKnown ? null : requestedSort;
  const categoryOptions = useMemo(
    () => pluginCategoryFilterOptions(entries, selectedCategories),
    [entries, selectedCategories],
  );
  const filteredEntries = useMemo(() => {
    if (selectedCategories.length === 0) return entries;
    const selected = new Set(selectedCategories);
    return entries.filter((entry) =>
      selected.has(pluginCategoryFilterId(entry)),
    );
  }, [entries, selectedCategories]);
  const shelves = useMemo(
    () =>
      pluginBrowseShelves({
        entries: filteredEntries,
        collections: selectedCategories.length === 0 ? catalog.collections : [],
      }),
    [catalog.collections, filteredEntries, selectedCategories.length],
  );
  const activeShelf = shelves.find((shelf) => shelf.key === activeShelfKey);
  const displayedEntries = activeShelf?.entries ?? filteredEntries;
  const flatEntries = useMemo(
    () =>
      sort === null
        ? displayedEntries
        : sortPluginEntries(displayedEntries, sort, sortDirection),
    [displayedEntries, sort, sortDirection],
  );

  const changeSearchParams = (
    change: (next: URLSearchParams) => void,
    replace = true,
  ) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next, { replace });
  };
  const openComposer = (seed?: string) =>
    setHeroRequest({
      nonce: nextComposerRequestNonce(),
      ...(seed === undefined ? {} : { seed }),
    });
  if (requestedCreationView !== creationViewActive) {
    setRequestedCreationView(creationViewActive);
    setHeroRequest({
      nonce: nextComposerRequestNonce(),
      ...(creationViewActive ? {} : { close: true }),
    });
  }
  useEffect(() => {
    if (heroRequest === null) return;
    const viewport = document.getElementById("plugins-browse-results");
    viewport?.scrollTo?.({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [heroRequest]);

  return (
    <ResourceCollectionViewport scrollId="plugins-browse-results">
      <div className={cn("space-y-7 pb-8", TOOLS_PAGE_BAND_CLASSES)}>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <OpenPluginGuideButton />
          <div className="flex items-stretch">
            <Button
              className="rounded-r-none"
              onClick={() => {
                if (creationViewActive) return;
                changeSearchParams((next) => next.set("view", "create"), false);
              }}
            >
              <Icon name="MessageSquarePlus" className="size-3.5" />
              Create a plugin
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Create a plugin options"
                  className="rounded-l-none border-l border-l-primary-foreground/20 px-1.5"
                >
                  <Icon name="ChevronDown" className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max min-w-40">
                <DropdownMenuItem onSelect={onInstallFromSource}>
                  <Icon name="Download" className="size-4" />
                  Install from source
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <BrowseHeroCarousel
          openRequest={heroRequest}
          onComposingChange={setComposing}
        />

        {composing ? (
          <BrowseArchetypeCards onCreate={openComposer} />
        ) : (
          <section className="space-y-6">
            <div className="mx-auto w-full max-w-3xl">
              <PluginCollectionToolbar
                categoryOptions={categoryOptions}
                hasInstallCounts={installsKnown}
              />
            </div>

            {searchQuery.isError && entries.length > 0 ? (
              <p className="text-xs text-warning-text" role="status">
                The latest search failed. The page shows saved catalog results.
              </p>
            ) : null}
            {searchQuery.isPending ? (
              <ResourceListState state="loading" message="Loading plugins" />
            ) : entries.length === 0 ? (
              <ResourceListState
                state={searchQuery.isError ? "error" : "empty"}
                message={
                  searchQuery.isError
                    ? "The plugin catalog is not available."
                    : "No plugins match this search."
                }
                onRetry={
                  searchQuery.isError
                    ? () => {
                        void searchQuery.refetch();
                      }
                    : undefined
                }
              />
            ) : filteredEntries.length === 0 ? (
              <ResourceListState
                state="empty"
                message="No plugins match these category filters."
              />
            ) : activeShelf !== undefined ? (
              <div
                className="space-y-4"
                data-testid="plugin-browse-shelf-detail"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    changeSearchParams((next) => next.delete("shelf"), false)
                  }
                >
                  <Icon name="ChevronLeft" className="size-3.5" aria-hidden />
                  Back to Browse
                </Button>
                <PluginShelfHeader shelf={activeShelf} showCount />
                <PluginCatalogGrid
                  entries={flatEntries}
                  showCategory
                  onInstall={onInstall}
                  onOpenPlugin={onOpenPlugin}
                  onUninstall={onUninstall}
                />
              </div>
            ) : sort === null ? (
              <div className="space-y-8" data-testid="plugin-browse-shelves">
                {shelves.map((shelf) => (
                  <BrowseShelf
                    key={shelf.key}
                    shelf={shelf}
                    showCount={selectedCategories.length > 0}
                    onExpand={() =>
                      changeSearchParams(
                        (next) => next.set("shelf", shelf.key),
                        false,
                      )
                    }
                    onInstall={onInstall}
                    onOpenPlugin={onOpenPlugin}
                    onUninstall={onUninstall}
                  />
                ))}
              </div>
            ) : (
              <PluginCatalogGrid
                entries={flatEntries}
                showCategory
                onInstall={onInstall}
                onOpenPlugin={onOpenPlugin}
                onUninstall={onUninstall}
              />
            )}
          </section>
        )}
      </div>
    </ResourceCollectionViewport>
  );
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
    if (!labels.has(id)) {
      labels.set(
        id,
        id === UNCATEGORIZED_PLUGIN_CATEGORY_ID
          ? "Uncategorized"
          : (entry.category ?? id),
      );
      if (
        id !== UNCATEGORIZED_PLUGIN_CATEGORY_ID &&
        pluginCatalogCategory(id) === undefined
      ) {
        unknownIds.push(id);
      }
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const id of selected) {
    if (labels.has(id)) continue;
    const category = pluginCatalogCategory(id);
    labels.set(
      id,
      id === UNCATEGORIZED_PLUGIN_CATEGORY_ID
        ? "Uncategorized"
        : (category?.displayName ?? id),
    );
    if (id !== UNCATEGORIZED_PLUGIN_CATEGORY_ID && category === undefined) {
      unknownIds.push(id);
    }
  }
  const orderedIds = [
    ...PLUGIN_CATALOG_CATEGORIES.map((category) => category.id).filter((id) =>
      labels.has(id),
    ),
    ...unknownIds,
    ...(labels.has(UNCATEGORIZED_PLUGIN_CATEGORY_ID)
      ? [UNCATEGORIZED_PLUGIN_CATEGORY_ID]
      : []),
  ];
  return orderedIds.map((id) => ({
    id,
    label: pluginCategoryDisplayName(id, labels.get(id) ?? id),
    count: counts.get(id) ?? 0,
  }));
}

function PluginShelfHeader({
  shelf,
  showCount,
  action,
}: {
  shelf: PluginBrowseShelf;
  showCount: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="relative min-w-0 space-y-1 pl-3">
        <span
          className="absolute inset-y-0 left-0 w-0.5 rounded-full"
          style={pluginCatalogCategoryMutedAccentStyle(shelf.categoryId)}
          aria-hidden
        />
        <h2 className="text-sm font-medium text-foreground">
          {pluginCategoryDisplayName(shelf.categoryId, shelf.label)}
          {showCount ? (
            <span className="ml-2 text-xs font-normal tabular-nums text-subtle-foreground">
              {shelf.entries.length.toLocaleString()}
            </span>
          ) : null}
        </h2>
        {shelf.description === undefined ? null : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {shelf.description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function BrowseShelf({
  shelf,
  showCount,
  onExpand,
  onInstall,
  onOpenPlugin,
  onUninstall,
}: {
  shelf: PluginBrowseShelf;
  showCount: boolean;
  onExpand: () => void;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
  onUninstall?: (pluginId: string) => void;
}) {
  const visible = shelf.entries.slice(0, SHELF_ENTRY_LIMIT);
  return (
    <section className="space-y-3">
      <PluginShelfHeader
        shelf={shelf}
        showCount={showCount}
        action={
          visible.length < shelf.entries.length ? (
            <ResourceShelfAction onClick={onExpand}>
              View all
              <Icon name="ChevronRight" className="size-3.5" aria-hidden />
            </ResourceShelfAction>
          ) : undefined
        }
      />
      <div data-plugin-shelf>
        <div data-plugin-shelf-grid className="grid gap-2">
          {visible.map((entry) => (
            <PluginCatalogCard
              key={`${entry.marketplace}/${entry.entryId}`}
              entry={entry}
              showCategory={false}
              onInstall={onInstall}
              onOpenPlugin={onOpenPlugin}
              onUninstall={onUninstall}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function PluginCatalogGrid({
  entries,
  showCategory,
  onInstall,
  onOpenPlugin,
  onUninstall,
}: {
  entries: readonly PluginCatalogSearchEntry[];
  showCategory: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
  onUninstall?: (pluginId: string) => void;
}) {
  return (
    <ResourceBrowseGrid className="mx-auto w-full max-w-3xl grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
      {entries.map((entry) => (
        <PluginCatalogCard
          key={`${entry.marketplace}/${entry.entryId}`}
          entry={entry}
          showCategory={showCategory}
          onInstall={onInstall}
          onOpenPlugin={onOpenPlugin}
          onUninstall={onUninstall}
        />
      ))}
    </ResourceBrowseGrid>
  );
}

export function PluginCatalogCard({
  entry,
  showCategory,
  onInstall,
  onOpenPlugin,
  onUninstall,
}: {
  entry: PluginCatalogSearchEntry;
  showCategory: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
  onUninstall?: (pluginId: string) => void;
}) {
  const count =
    entry.installs === null
      ? undefined
      : {
          display: formatPluginInstallCount(entry.installs),
          accessibleLabel: `${entry.installs.toLocaleString()} ${entry.installs === 1 ? "install" : "installs"}`,
        };
  return (
    <PluginCard
      leading={<CatalogEntryIconChip entry={entry} />}
      title={entry.displayName}
      description={entry.description || undefined}
      byline={<PluginCardAuthor entry={entry} />}
      footerMeta={
        showCategory && entry.category !== undefined ? (
          <PluginCategoryLabel
            categoryId={entry.categoryId}
            label={entry.category}
          />
        ) : undefined
      }
      headerAction={
        entry.installed ? (
          <PluginCatalogInstallControl
            displayName={entry.displayName}
            installed
            included={entry.source.startsWith("builtin:")}
            onUninstall={
              onUninstall === undefined
                ? undefined
                : () => onUninstall(entry.pluginId)
            }
            count={count}
          />
        ) : (
          <PluginCatalogInstallControl
            displayName={entry.displayName}
            installed={false}
            disabled={!entry.compatible}
            count={count}
            onInstall={() =>
              onInstall({
                entryId: entry.entryId,
                marketplace: entry.marketplace,
                pluginId: entry.pluginId,
                publisherLabel: entry.publisherLabel,
                displayName: entry.displayName,
                icon: entry.icon,
                iconUrl: entry.iconUrl,
                iconTinted: entry.iconTinted,
                source: entry.source,
              })
            }
          />
        )
      }
      openLabel={`Open ${entry.displayName} details`}
      onOpen={(trigger) => onOpenPlugin(entry.pluginId, trigger)}
    />
  );
}
