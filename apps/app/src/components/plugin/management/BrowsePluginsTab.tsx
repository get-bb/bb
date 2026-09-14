import { useEffect, useMemo, useState } from "react";
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
import bbLogoUrl from "../../../../../../assets/bb-logo.svg";
import { OpenPluginGuideButton } from "./OpenPluginGuideButton";
import { cn } from "@bb/shared-ui/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  ResourceBrowseGrid,
  ResourceCollectionViewport,
  ResourceInstallControl,
  ResourceInstalledControl,
  ResourceListState,
  ResourceShelfSeeAllAction,
  ResourceSourceShelf,
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
import {
  PluginCollectionToolbar,
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
  PluginCategoryLabel,
  pluginCatalogCategoryMutedAccentStyle,
  pluginInstallCountPresentation,
} from "./plugin-ui";

const SHELF_ENTRY_LIMIT = 6;

export function BrowsePluginsTab({
  onInstall,
  onOpenPlugin,
  onInstallFromSource,
}: {
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
  onInstallFromSource: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("query") ?? "";
  const creationViewActive = searchParams.get("view") === "create";
  const selectedCategories = searchParams.getAll("category");
  const requestedSort = pluginBrowseSort(searchParams.get("sort"));
  const sortDirection =
    pluginBrowseSortDirection(searchParams.get("direction")) ??
    (requestedSort === "name" ? "asc" : "desc");
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
  const [expandedShelves, setExpandedShelves] = useState<Set<string>>(
    () => new Set(),
  );
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
        collections: catalog.collections,
      }),
    [catalog.collections, filteredEntries],
  );
  const flatEntries = useMemo(
    () =>
      sort === null
        ? []
        : sortPluginEntries(filteredEntries, sort, sortDirection),
    [filteredEntries, sort, sortDirection],
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
    <ResourceCollectionViewport
      scrollId="plugins-browse-results"
      contentClassName="[&>div]:block!"
    >
      <div className={cn("space-y-7 pb-8", TOOLS_PAGE_BAND_CLASSES)}>
        <div className="ml-auto flex w-fit flex-col items-center gap-2">
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
          <OpenPluginGuideButton />
        </div>

        <BrowseHeroCarousel
          openRequest={heroRequest}
          onComposingChange={setComposing}
        />

        {composing ? (
          <BrowseArchetypeCards onCreate={openComposer} />
        ) : (
          <section className="space-y-6">
            <PluginCollectionToolbar
              query={query}
              selectedCategories={selectedCategories}
              categoryOptions={categoryOptions}
              sort={sort}
              sortDirection={sortDirection}
              installsKnown={installsKnown}
              changeSearchParams={changeSearchParams}
            />

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
            ) : sort === null ? (
              <div className="space-y-8" data-testid="plugin-browse-shelves">
                {shelves.map((shelf) => (
                  <BrowseShelf
                    key={shelf.key}
                    shelf={shelf}
                    expanded={expandedShelves.has(shelf.key)}
                    onExpand={() =>
                      setExpandedShelves((current) =>
                        new Set(current).add(shelf.key),
                      )
                    }
                    onInstall={onInstall}
                    onOpenPlugin={onOpenPlugin}
                  />
                ))}
              </div>
            ) : (
              <PluginCatalogGrid
                entries={flatEntries}
                onInstall={onInstall}
                onOpenPlugin={onOpenPlugin}
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
    label: labels.get(id) ?? id,
    count: counts.get(id) ?? 0,
  }));
}

function BrowseShelf({
  shelf,
  expanded,
  onExpand,
  onInstall,
  onOpenPlugin,
}: {
  shelf: PluginBrowseShelf;
  expanded: boolean;
  onExpand: () => void;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  const visible = expanded
    ? shelf.entries
    : shelf.entries.slice(0, SHELF_ENTRY_LIMIT);
  return (
    <ResourceSourceShelf
      label={shelf.label}
      description={shelf.description}
      leading={
        shelf.key === "collection:bb-official" ? (
          <span
            className="size-4 shrink-0 bg-current text-foreground"
            style={{ mask: `url(${bbLogoUrl}) center / contain no-repeat` }}
            aria-hidden
          />
        ) : shelf.key === "collection:new-and-notable" ? (
          <Icon name="News01" className="size-4 text-foreground" aria-hidden />
        ) : (
          <span
            className="size-2 rounded-full"
            style={pluginCatalogCategoryMutedAccentStyle(shelf.categoryId)}
            aria-hidden
          />
        )
      }
      browseAction={
        !expanded && shelf.entries.length > 2 ? (
          <ResourceShelfSeeAllAction
            type="button"
            onClick={onExpand}
            className={
              shelf.entries.length <= SHELF_ENTRY_LIMIT
                ? "sm:hidden"
                : undefined
            }
          />
        ) : undefined
      }
    >
      <div data-plugin-shelf>
        <div
          data-plugin-shelf-grid
          className={cn(
            "grid gap-2",
            !expanded && "max-sm:[&>*:nth-child(n+3)]:hidden",
          )}
        >
          {visible.map((entry) => (
            <PluginCatalogCard
              key={`${entry.marketplace}/${entry.entryId}`}
              entry={entry}
              showCategory={false}
              onInstall={onInstall}
              onOpenPlugin={onOpenPlugin}
            />
          ))}
        </div>
      </div>
    </ResourceSourceShelf>
  );
}

export function PluginCatalogGrid({
  entries,
  onInstall,
  onOpenPlugin,
}: {
  entries: readonly PluginCatalogSearchEntry[];
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <ResourceBrowseGrid className="mx-auto w-full max-w-3xl grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
      {entries.map((entry) => (
        <PluginCatalogCard
          key={`${entry.marketplace}/${entry.entryId}`}
          entry={entry}
          showCategory
          onInstall={onInstall}
          onOpenPlugin={onOpenPlugin}
        />
      ))}
    </ResourceBrowseGrid>
  );
}

function PluginCatalogCard({
  entry,
  showCategory,
  onInstall,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  showCategory: boolean;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  const count = pluginInstallCountPresentation(entry.installs);
  return (
    <PluginCard
      leading={<CatalogEntryIconChip entry={entry} compact />}
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
          <ResourceInstalledControl accessibleLabel="Installed" count={count} />
        ) : (
          <ResourceInstallControl
            accessibleLabel={`Install ${entry.displayName}${
              count === undefined ? "" : ` — ${count.accessibleLabel}`
            }`}
            disabled={!entry.compatible}
            presentation="compact"
            tooltip={`Install ${entry.displayName}`}
            count={count}
            className="border-border/80 bg-background text-foreground shadow-none hover:bg-state-hover"
            onAction={() =>
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
