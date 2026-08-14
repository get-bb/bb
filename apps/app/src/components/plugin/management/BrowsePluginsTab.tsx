import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
  ResourceCollectionViewport,
  ResourceInstallControl,
  ResourceListState,
  ResourceMultiSelectMenu,
  ResourceSortMenu,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { appToast } from "@/components/ui/app-toast";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { BrowseArchetypeCards } from "@/components/plugin/browse-hero/BrowseArchetypeCards";
import { nextComposerRequestNonce } from "@/components/plugin/browse-hero/browse-hero-archetypes";
import { BrowseHeroCarousel } from "@/components/plugin/browse-hero/BrowseHeroCarousel";
import {
  invalidatePluginCatalogSearch,
  invalidatePluginList,
} from "@/hooks/cache-owners/plugin-cache-owner";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { removePlugin } from "@/hooks/queries/plugin-settings-queries";
import type { AddPluginInitial } from "./AddPluginDialog";
import { CatalogEntryIcon } from "./plugin-ui";

/**
 * The Browse page: hero → one CTA row (create + install-from-source) → then
 * ONE of two mutually exclusive bodies. Browsing shows the search toolbar and
 * the installable grid; composing swaps that for the example cards, since the
 * examples exist to feed the open composer. Every create-shaped affordance
 * opens the hero's inline composer in place; nothing navigates away.
 */
export function BrowsePluginsTab({
  onInstall,
  onOpenPlugin,
  onInstallFromSource,
}: {
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
  /** Opens the Add-plugin dialog; rendered beside the hero CTA. */
  onInstallFromSource: () => void;
}) {
  const [query, setQuery] = useState("");
  // Example cards and the page button open the hero's inline composer through
  // this request; nonces make a repeated click on the same card still land.
  const [searchParams, setSearchParams] = useSearchParams();
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
  const openComposer = (seed?: string) =>
    setHeroRequest({
      nonce: nextComposerRequestNonce(),
      ...(seed === undefined ? {} : { seed }),
    });
  // Creation is a real navigation entry so the app shell's existing sidebar
  // Back control owns the return to Browse. POP/forward navigation then drives
  // the inline composer without adding another page-local back affordance.
  if (requestedCreationView !== creationViewActive) {
    setRequestedCreationView(creationViewActive);
    setHeroRequest({
      nonce: nextComposerRequestNonce(),
      ...(creationViewActive ? {} : { close: true }),
    });
  }
  // The composer lives in the hero at the top; opening it from a card further
  // down must bring it into view or the click appears to do nothing.
  useEffect(() => {
    if (heroRequest === null) return;
    const viewport = document.getElementById("plugins-browse-results");
    // Optional call: jsdom implements elements without scrollTo.
    viewport?.scrollTo?.({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [heroRequest]);
  // Empty means unfiltered, matching the Type filters on Installed and Skills.
  const [categories, setCategories] = useState<string[]>([]);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [debouncedQuery] = useDebounceValue(query.trim(), 300);
  const searchQuery = usePluginCatalogSearch(debouncedQuery, { enabled: true });
  const entries = searchQuery.data ?? [];
  const availableCategories: string[] = [];
  for (const entry of entries) {
    if (!availableCategories.includes(entry.category)) {
      availableCategories.push(entry.category);
    }
  }
  for (const selected of categories) {
    if (!availableCategories.includes(selected)) {
      availableCategories.push(selected);
    }
  }
  const categoryOptions = availableCategories.map((name) => ({
    id: name,
    label: name,
  }));
  const visibleEntries =
    categories.length === 0
      ? entries
      : entries.filter((entry) => categories.includes(entry.category));
  const groups = groupByMarketplace(visibleEntries, sortDirection);
  // One group is the ordinary case (only BB Official is registered): naming it
  // would add page chrome that tells the user nothing. A second marketplace is
  // exactly when the origin of an entry starts to matter.
  const showMarketplaceHeadings = groups.length > 1;

  return (
    <ResourceCollectionViewport scrollId="plugins-browse-results">
      {/* One wrapper owns the page rhythm and centers the content column: the
          scroller spans the whole pane so the wheel works from the gutters.
          (Spacing utilities on the scroll viewport itself never fire: Radix
          interposes a display:table div, so the sections would not be siblings
          of each other there.) */}
      <div className={cn("space-y-7", TOOLS_PAGE_BAND_CLASSES)}>
        {/* The create control sits at the page's top right, like every other
            collection's actions row; the hero keeps only its showcase. */}
        <div className="flex items-center justify-end gap-3">
          <div className="flex items-stretch">
            <Button
              className="rounded-r-none"
              onClick={() => {
                if (creationViewActive) return;
                const nextSearchParams = new URLSearchParams(searchParams);
                nextSearchParams.set("view", "create");
                setSearchParams(nextSearchParams);
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
          /* The examples exist to feed the open composer, so they appear only
             in this state — browsing and composing are mutually exclusive
             bodies below one stable hero. */
          <BrowseArchetypeCards onCreate={openComposer} />
        ) : (
          <section>
            {/* Compact and centered under the hero: the search scopes the
                grid below, and full width here would read as page chrome. */}
            <div className="mx-auto w-full max-w-[32rem]">
              <ResourceToolbar
                searchValue={query}
                searchPlaceholder="Search plugins"
                onSearchChange={setQuery}
                controls={
                  <>
                    {categoryOptions.length > 0 ? (
                      <ResourceMultiSelectMenu
                        label="Category"
                        icon="SlidersHorizontal"
                        compact
                        selectedValues={categories}
                        options={categoryOptions}
                        onChange={setCategories}
                      />
                    ) : null}
                    <ResourceSortMenu
                      value="alpha"
                      direction={sortDirection}
                      compact
                      options={[{ id: "alpha", label: "Plugin name" }]}
                      onChange={() =>
                        setSortDirection((current) =>
                          current === "asc" ? "desc" : "asc",
                        )
                      }
                    />
                  </>
                }
              />
            </div>

            <div className="mt-7 space-y-3">
              {searchQuery.isError && entries.length > 0 ? (
                <p className="text-xs text-warning-text" role="status">
                  Showing cached catalog results because the latest search
                  failed.
                </p>
              ) : null}

              {searchQuery.isPending ? (
                <ResourceListState state="loading" message="Loading plugins" />
              ) : entries.length === 0 ? (
                <ResourceListState
                  state={searchQuery.isError ? "error" : "empty"}
                  message={
                    searchQuery.isError
                      ? "BB's official plugins are unavailable."
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
              ) : (
                <div className="space-y-3">
                  {groups.length === 0 ? (
                    <ResourceListState
                      state="empty"
                      message="No plugins match these filters."
                    />
                  ) : (
                    groups.map((group) => (
                      <section key={group.marketplace} className="space-y-3">
                        {showMarketplaceHeadings ? (
                          <h2 className="flex items-baseline gap-2 text-sm font-medium text-foreground">
                            {group.displayName}
                            {group.official ? null : (
                              <span className="text-2xs font-normal text-subtle-foreground">
                                third-party marketplace
                              </span>
                            )}
                          </h2>
                        ) : null}
                        {group.sections.map((section) => (
                          <div key={section.category} className="space-y-2">
                            <h3 className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
                              {section.category}
                            </h3>
                            <ResourceBrowseGrid className="grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
                              {section.entries.map((entry) => (
                                <BrowseCard
                                  key={`${entry.marketplace}/${entry.entryId}`}
                                  entry={entry}
                                  installedPluginId={
                                    entry.installed ? entry.pluginId : null
                                  }
                                  onInstall={onInstall}
                                  onOpenPlugin={onOpenPlugin}
                                />
                              ))}
                            </ResourceBrowseGrid>
                          </div>
                        ))}
                      </section>
                    ))
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </ResourceCollectionViewport>
  );
}

interface MarketplaceGroup {
  marketplace: string;
  displayName: string;
  official: boolean;
  sections: { category: string; entries: PluginCatalogSearchEntry[] }[];
}

/**
 * Group the catalog the way the store reads it: by marketplace (the server
 * returns the official one first), then by the tag-derived section within each
 * one. Encounter order is the server's order, so grouping never reshuffles it.
 */
function groupByMarketplace(
  entries: readonly PluginCatalogSearchEntry[],
  sortDirection: "asc" | "desc",
): MarketplaceGroup[] {
  const groups: MarketplaceGroup[] = [];
  for (const entry of entries) {
    let group = groups.find((item) => item.marketplace === entry.marketplace);
    if (group === undefined) {
      group = {
        marketplace: entry.marketplace,
        displayName: entry.marketplaceDisplayName,
        official: entry.official,
        sections: [],
      };
      groups.push(group);
    }
    const section = group.sections.find(
      (item) => item.category === entry.category,
    );
    if (section === undefined) {
      group.sections.push({ category: entry.category, entries: [entry] });
    } else {
      section.entries.push(entry);
    }
  }
  for (const group of groups) {
    for (const section of group.sections) {
      section.entries.sort((left, right) => {
        const result = left.displayName.localeCompare(right.displayName);
        if (result !== 0) return sortDirection === "asc" ? result : -result;
        return left.entryId.localeCompare(right.entryId);
      });
    }
  }
  return groups;
}

function BrowseCard({
  entry,
  installedPluginId,
  onInstall,
  onOpenPlugin,
}: {
  entry: PluginCatalogSearchEntry;
  installedPluginId: string | null;
  onInstall: (initial: AddPluginInitial) => void;
  onOpenPlugin: (pluginId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const uninstall = useMutation({
    mutationFn: () => {
      if (installedPluginId === null) {
        throw new Error("Installed plugin id is unavailable");
      }
      return removePlugin(fetch, installedPluginId);
    },
    onSuccess: () => {
      setConfirmingUninstall(false);
      invalidatePluginList({ queryClient });
      invalidatePluginCatalogSearch({ queryClient });
      appToast.success(`${entry.displayName} uninstalled`);
    },
    onError: (error) => {
      appToast.error(`Uninstalling ${entry.displayName} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const leading = <CatalogEntryIcon entry={entry} className="size-6" />;
  const description =
    entry.description.length > 0 ? entry.description : undefined;
  const descriptionArea = (
    <span className="block min-h-[2lh]">{description}</span>
  );
  // Why an entry cannot be installed outranks who wrote it.
  const byline =
    !entry.compatible && entry.incompatibleReason !== null ? (
      <span className="text-warning-text">{entry.incompatibleReason}</span>
    ) : entry.author !== null ? (
      <span>{entry.author.name}</span>
    ) : undefined;
  const footerMeta = entry.official ? undefined : (
    <span className="text-2xs text-subtle-foreground">
      {entry.marketplaceDisplayName}
    </span>
  );
  const headerAction =
    installedPluginId !== null ? (
      <ResourceInstallControl
        accessibleLabel={`Uninstall ${entry.displayName}`}
        pending={uninstall.isPending}
        presentation="icon"
        tooltip={`Uninstall ${entry.displayName}`}
        className="border-transparent bg-transparent text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))] shadow-none hover:border-transparent hover:bg-transparent hover:text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))] focus-visible:border-transparent focus-visible:bg-transparent focus-visible:text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))]"
        onAction={() => setConfirmingUninstall(true)}
      />
    ) : (
      <ResourceInstallControl
        accessibleLabel={`Install ${entry.displayName}`}
        disabled={!entry.compatible}
        presentation="icon"
        tooltip={`Install ${entry.displayName}`}
        onAction={() =>
          onInstall({
            entryId: entry.entryId,
            marketplace: entry.marketplace,
            displayName: entry.displayName,
            icon: entry.icon,
            iconUrl: entry.iconUrl,
            source: entry.source,
          })
        }
      />
    );

  return (
    <>
      <ResourceBrowseCard
        className="min-h-20 gap-x-2 gap-y-1.5 p-2.5"
        leading={leading}
        title={entry.displayName}
        description={descriptionArea}
        byline={byline}
        footerMeta={footerMeta}
        headerAction={headerAction}
        openLabel={`Open ${entry.displayName} details`}
        onOpen={() => onOpenPlugin(entry.pluginId)}
      />
      <ConfirmDeleteDialog
        open={confirmingUninstall}
        onOpenChange={(open) => {
          if (!uninstall.isPending) setConfirmingUninstall(open);
        }}
      >
        <ConfirmDeleteDialogContent
          title={`Uninstall ${entry.displayName}?`}
          description="The plugin will be removed from this BB host. Plugin data may be retained for a future reinstall."
          confirmLabel={uninstall.isPending ? "Uninstalling…" : "Uninstall"}
          pending={uninstall.isPending}
          onConfirm={() => uninstall.mutate()}
          onCancel={() => setConfirmingUninstall(false)}
        />
      </ConfirmDeleteDialog>
    </>
  );
}
