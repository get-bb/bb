import { usePluginCollectionParams } from "./usePluginCollectionParams";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import bbLogoUrl from "../../../../../../assets/bb-logo.svg";
import { OpenPluginGuideButton } from "./OpenPluginGuideButton";
import { cn } from "@bb/shared-ui/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  ResourceCollectionViewport,
  ResourceListState,
  ResourceShelfAction,
  ResourceSourceShelf,
  ResourceTabDescription,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { BrowseArchetypeCards } from "@/components/plugin/browse-hero/BrowseArchetypeCards";
import { BrowseHeroCarousel } from "@/components/plugin/browse-hero/BrowseHeroCarousel";
import { nextComposerRequestNonce } from "@/components/plugin/browse-hero/browse-hero-archetypes";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { getPluginsRoutePath } from "@/lib/route-paths";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import type { AddPluginInitial } from "./AddPluginDialog";
import { PluginCatalogCard, PluginCatalogGrid } from "./PluginCatalogCard";
import { PluginCollectionToolbar } from "./PluginBrowseControls";
import { PluginCreateButton } from "../PluginCreateButton";
import { PLUGINS_BROWSE_DESCRIPTION } from "../plugins-collection-copy";
import {
  pluginBrowseShelves,
  pluginCategoryFilterId,
  pluginCategoryFilterOptions,
  sortPluginEntries,
  type PluginBrowseShelf,
} from "./plugin-browse-discovery";
import { pluginCatalogCategoryMutedAccentStyle } from "./plugin-ui";

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
  const isCompact = useIsCompactViewport();
  const {
    searchParams,
    query,
    requestedSort,
    sortDirection,
    selectedCategories,
    changeSearchParams,
  } = usePluginCollectionParams();
  const shelfKey = searchParams.get("shelf");
  const isCategoryShelf = shelfKey?.startsWith("category:") ?? false;
  const creationViewActive = searchParams.get("view") === "create";
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
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const searchQuery = usePluginCatalogSearch(debouncedQuery, { enabled: true });
  const catalogQuery = usePluginCatalogSearch("", {
    enabled: shelfKey !== null,
  });
  const activeQuery = shelfKey === null ? searchQuery : catalogQuery;
  const catalog = activeQuery.data ?? { entries: [], collections: [] };
  const entries = useMemo(
    () => catalog.entries.filter((entry) => entry.compatible),
    [catalog.entries],
  );
  const selectedShelf = useMemo(
    () =>
      shelfKey === null
        ? undefined
        : pluginBrowseShelves({
            entries,
            collections: catalog.collections,
          }).find((shelf) => shelf.key === shelfKey),
    [catalog.collections, entries, shelfKey],
  );
  useResourceRouteLabel(selectedShelf?.label ?? null);
  const shelfEntries = useMemo(
    () => (shelfKey === null ? entries : (selectedShelf?.entries ?? [])),
    [entries, selectedShelf, shelfKey],
  );
  const installsKnown = shelfEntries.some((entry) => entry.installs !== null);
  const sort =
    requestedSort === "most-installed" && !installsKnown ? null : requestedSort;
  const categoryOptions = useMemo(
    () => pluginCategoryFilterOptions(shelfEntries, selectedCategories),
    [shelfEntries, selectedCategories],
  );
  const filteredEntries = useMemo(() => {
    const selected = new Set(selectedCategories);
    const matchingSearch =
      shelfKey !== null && debouncedQuery !== ""
        ? new Set(
            searchQuery.data?.entries.map(
              (entry) => `${entry.marketplace}/${entry.entryId}`,
            ),
          )
        : null;
    return shelfEntries.filter(
      (entry) =>
        (selected.size === 0 || selected.has(pluginCategoryFilterId(entry))) &&
        (matchingSearch === null ||
          matchingSearch.has(`${entry.marketplace}/${entry.entryId}`)),
    );
  }, [
    debouncedQuery,
    searchQuery.data?.entries,
    selectedCategories,
    shelfEntries,
    shelfKey,
  ]);
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
        ? filteredEntries
        : sortPluginEntries(filteredEntries, sort, sortDirection),
    [filteredEntries, sort, sortDirection],
  );
  const browseParams = new URLSearchParams(searchParams);
  browseParams.delete("shelf");
  const browseSearch = browseParams.toString();

  const openComposer = (seed?: string) =>
    setHeroRequest({
      nonce: nextComposerRequestNonce(),
      ...(seed === undefined ? {} : { seed }),
    });
  const createAction = (
    <PluginCreateButton
      onCreate={(seed) => {
        if (seed !== undefined) {
          openComposer(seed);
        } else if (!creationViewActive) {
          changeSearchParams((next) => next.set("view", "create"), false);
        }
      }}
      onInstallFromSource={onInstallFromSource}
    />
  );
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
      key={shelfKey ?? "browse"}
      scrollId="plugins-browse-results"
      contentClassName="[&>div]:block!"
    >
      <div className={cn("space-y-7 pb-8", TOOLS_PAGE_BAND_CLASSES)}>
        {shelfKey !== null ? (
          <div className="w-full space-y-2">
            <Link
              to={{ pathname: getPluginsRoutePath(), search: browseSearch }}
              className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Icon name="ChevronLeft" className="size-3" aria-hidden />
              Browse plugins
            </Link>
            {selectedShelf === undefined ? null : (
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-foreground">
                <span className="inline-flex min-w-0 items-center gap-2">
                  {selectedShelf.key.startsWith("category:") ? (
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={pluginCatalogCategoryMutedAccentStyle(
                        selectedShelf.categoryId,
                      )}
                      aria-hidden
                    />
                  ) : null}
                  {selectedShelf.label}
                </span>{" "}
                <span className="rounded-md bg-muted px-2 py-1 text-2xs font-medium tabular-nums text-subtle-foreground">
                  {selectedShelf.entries.length.toLocaleString()}{" "}
                  {selectedShelf.entries.length === 1 ? "plugin" : "plugins"}
                </span>
              </h1>
            )}
          </div>
        ) : (
          <>
            {isCompact ? (
              <ResourceTabDescription>
                {PLUGINS_BROWSE_DESCRIPTION}
              </ResourceTabDescription>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <OpenPluginGuideButton />
                {createAction}
              </div>
            )}

            <div className={cn(!composing && isCompact && "hidden")}>
              <BrowseHeroCarousel
                openRequest={heroRequest}
                onComposingChange={setComposing}
              />
            </div>
          </>
        )}

        {composing && shelfKey === null ? (
          <BrowseArchetypeCards onCreate={openComposer} />
        ) : (
          <section className="space-y-6">
            <PluginCollectionToolbar
              query={query}
              selectedCategories={selectedCategories}
              categoryOptions={categoryOptions}
              showCategoryFilter={!isCategoryShelf}
              sort={sort}
              sortDirection={sortDirection}
              installsKnown={installsKnown}
              changeSearchParams={changeSearchParams}
              action={isCompact && shelfKey === null ? createAction : undefined}
            />

            {(searchQuery.isError || activeQuery.isError) &&
            entries.length > 0 ? (
              <p className="text-xs text-warning-text" role="status">
                The latest search failed. The page shows saved catalog results.
              </p>
            ) : null}
            {activeQuery.isPending ||
            (shelfKey !== null &&
              debouncedQuery !== "" &&
              searchQuery.isPending) ? (
              <ResourceListState state="loading" message="Loading plugins" />
            ) : activeQuery.isError && entries.length === 0 ? (
              <ResourceListState
                state="error"
                message="The plugin catalog is not available."
                onRetry={() => void activeQuery.refetch()}
              />
            ) : shelfKey !== null && selectedShelf === undefined ? (
              <ResourceListState state="empty" message="Shelf not found." />
            ) : entries.length === 0 ? (
              <ResourceListState
                state="empty"
                message="No plugins match this search."
              />
            ) : searchQuery.isError && searchQuery.data === undefined ? (
              <ResourceListState
                state="error"
                message="The plugin search is not available."
                onRetry={() => void searchQuery.refetch()}
              />
            ) : filteredEntries.length === 0 ? (
              <ResourceListState
                state="empty"
                message="No plugins match these category filters."
              />
            ) : sort === null && shelfKey === null ? (
              <div className="space-y-8" data-testid="plugin-browse-shelves">
                {shelves.map((shelf) => (
                  <BrowseShelf
                    key={shelf.key}
                    shelf={shelf}
                    onInstall={onInstall}
                    onOpenPlugin={onOpenPlugin}
                  />
                ))}
              </div>
            ) : (
              <PluginCatalogGrid
                entries={flatEntries}
                showCategory={!isCategoryShelf}
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

function BrowseShelf({
  shelf,
  onInstall,
  onOpenPlugin,
}: {
  shelf: PluginBrowseShelf;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
}) {
  const [searchParams] = useSearchParams();
  const shelfParams = new URLSearchParams(searchParams);
  shelfParams.set("shelf", shelf.key);
  const visible = shelf.entries.slice(0, SHELF_ENTRY_LIMIT);
  return (
    <ResourceSourceShelf
      label={shelf.label}
      description={shelf.description}
      hideDescriptionOnMobile
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
        shelf.entries.length > 2 ? (
          <ResourceShelfAction
            asChild
            className={cn(
              "underline underline-offset-4",
              shelf.entries.length <= SHELF_ENTRY_LIMIT && "sm:hidden",
            )}
          >
            <Link
              to={{
                pathname: getPluginsRoutePath(),
                search: shelfParams.toString(),
              }}
              aria-label={`See all ${shelf.label}`}
            >
              See all
            </Link>
          </ResourceShelfAction>
        ) : undefined
      }
    >
      <div data-plugin-shelf>
        <div
          data-plugin-shelf-grid
          className="grid gap-2 max-sm:[&>*:nth-child(n+3)]:hidden"
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
