import {
  pluginSourceFilterId,
  pluginSourceFilterOptions,
} from "./plugin-provenance";
import { usePluginCollectionParams } from "./management/usePluginCollectionParams";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
  RESOURCE_GRID_PAGE_SIZE,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionViewport,
  ResourceListState,
  ResourceMultiSelectMenu,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "@/components/plugin/management/BrowsePluginsTab";
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
import { PluginAuthorPage } from "@/components/plugin/management/PluginAuthorPage";
import {
  usePluginCatalogSearch,
  usePluginUpdateCheck,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import {
  usePluginRemoval,
  PluginRemovalDialog,
} from "./management/usePluginRemoval";
import { installedPluginCatalogEntry } from "./management/installed-plugin-catalog";
import { PluginCollectionToolbar } from "./management/PluginBrowseControls";
import {
  pluginCategoryFilterId,
  pluginCategoryFilterOptions,
  sortPluginEntries,
} from "./management/plugin-browse-discovery";
import { PLUGINS_INSTALLED_DESCRIPTION } from "@/components/plugin/plugins-collection-copy";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";

export function PluginsOverview({
  onOpenPlugin,
  mode,
}: {
  mode?: "installed" | "browse";
  onOpenPlugin?: (pluginId: string, trigger: HTMLButtonElement) => void;
} = {}) {
  const navigate = useNavigate();
  const removal = usePluginRemoval();
  const {
    searchParams,
    query: installedQuery,
    requestedSort,
    sortDirection: installedSortDirection,
    selectedCategories,
    changeSearchParams,
  } = usePluginCollectionParams();
  const listQuery = usePluginList({ enabled: true });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data?.plugins],
  );
  const activeMode =
    mode ?? (searchParams.get("view") === "installed" ? "installed" : "browse");
  usePluginUpdateCheck(null, { enabled: activeMode === "installed" });
  const authorKey = searchParams.get("author");
  const catalogQuery = usePluginCatalogSearch("", {
    enabled: activeMode === "installed",
  });
  const installedEntries = useMemo(
    () =>
      plugins.map((plugin) => {
        const entry = installedPluginCatalogEntry(
          plugin,
          catalogQuery.data?.entries ?? [],
        );
        return {
          plugin,
          entryId: plugin.id,
          displayName: plugin.name ?? plugin.id,
          categoryId: entry?.categoryId ?? plugin.categoryId,
          category: entry?.category ?? plugin.category,
          publishedAt: entry?.publishedAt,
          installs: entry?.installs ?? null,
        };
      }),
    [plugins, catalogQuery.data?.entries],
  );
  const sourceFilterOptions = useMemo(
    () => pluginSourceFilterOptions(plugins),
    [plugins],
  );
  const sourceFilters = searchParams.getAll("source");
  const activeSourceFilters = sourceFilters.filter((value) =>
    sourceFilterOptions.some((option) => option.id === value),
  );
  const categoryOptions = useMemo(
    () => pluginCategoryFilterOptions(installedEntries, selectedCategories),
    [installedEntries, selectedCategories],
  );
  const installsKnown = installedEntries.some(
    (entry) => entry.installs !== null,
  );
  const installedSort =
    requestedSort === "most-installed" && !installsKnown ? null : requestedSort;
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const installedResetKey = [
    normalizedInstalledQuery,
    [...activeSourceFilters].sort().join(","),
    installedSort,
    installedSortDirection,
    [...selectedCategories].sort().join(","),
  ].join("\u0000");
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    initial: AddPluginInitial | null;
  }>({ open: false, initial: null });

  const visiblePlugins = useMemo(() => {
    const filtered = installedEntries.filter((entry) => {
      if (
        activeSourceFilters.length > 0 &&
        !activeSourceFilters.includes(pluginSourceFilterId(entry.plugin))
      )
        return false;
      if (
        selectedCategories.length > 0 &&
        !selectedCategories.includes(pluginCategoryFilterId(entry))
      )
        return false;
      if (normalizedInstalledQuery.length === 0) return true;
      const plugin = entry.plugin;
      return [
        plugin.id,
        plugin.name ?? "",
        plugin.description ?? "",
        plugin.version,
        plugin.sourceDisplay,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedInstalledQuery);
    });
    if (installedSort !== null)
      return sortPluginEntries(
        filtered,
        installedSort,
        installedSortDirection,
      ).map((entry) => entry.plugin);
    return filtered
      .map((entry) => entry.plugin)
      .sort((left, right) => {
        const enabledResult = Number(!left.enabled) - Number(!right.enabled);
        if (enabledResult !== 0) return enabledResult;
        if (left.enabled) {
          const publisherResult =
            Number(left.publisherLabel === null) -
            Number(right.publisherLabel === null);
          if (publisherResult !== 0) return publisherResult;
        }
        return (
          (left.name ?? left.id).localeCompare(right.name ?? right.id) ||
          left.id.localeCompare(right.id)
        );
      });
  }, [
    installedEntries,
    activeSourceFilters,
    selectedCategories,
    normalizedInstalledQuery,
    installedSort,
    installedSortDirection,
  ]);
  const installedList = useResourceInfiniteItems(visiblePlugins, {
    pageSize: RESOURCE_GRID_PAGE_SIZE,
    resetKey: installedResetKey,
  });

  const startCreatePlugin = (prompt?: string) => {
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: prompt !== undefined,
      },
    });
  };

  const uninstallCatalogEntry = (entry: PluginCatalogSearchEntry) => {
    const plugin = plugins.find(
      (candidate) =>
        installedPluginCatalogEntry(candidate, [entry]) !== undefined,
    );
    if (plugin !== undefined) removal.open(plugin);
  };

  const installedActions = (
    <>
      <CreateWithTemplatesButton
        kind="plugin"
        compactWhenNarrow
        label="New plugin"
        menuActions={[
          {
            label: "Install from source",
            icon: "Download",
            onSelect: () => setAddDialog({ open: true, initial: null }),
          },
        ]}
        onCreate={startCreatePlugin}
      />
    </>
  );

  const openPlugin =
    onOpenPlugin ??
    ((pluginId: string) =>
      navigate(
        getPluginDetailRoutePath({
          pluginId,
          view: activeMode === "installed" ? "installed" : undefined,
        }),
      ));
  let content: ReactNode;
  if (activeMode === "browse") {
    content =
      authorKey === null ? (
        <BrowsePluginsTab
          onInstall={(initial) => setAddDialog({ open: true, initial })}
          onUninstall={uninstallCatalogEntry}
          onOpenPlugin={openPlugin}
          onInstallFromSource={() =>
            setAddDialog({ open: true, initial: null })
          }
        />
      ) : (
        <PluginAuthorPage
          authorKey={authorKey}
          onInstall={(initial) => setAddDialog({ open: true, initial })}
          onUninstall={uninstallCatalogEntry}
          onOpenPlugin={openPlugin}
        />
      );
  } else {
    content = (
      <ResourceCollectionViewport
        scrollId="plugins-installed-results"
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
        toolbar={
          <PluginCollectionToolbar
            className="max-w-none"
            query={installedQuery}
            searchPlaceholder="Search installed plugins"
            selectedCategories={selectedCategories}
            categoryOptions={categoryOptions}
            sort={installedSort}
            sortDirection={installedSortDirection}
            installsKnown={installsKnown}
            changeSearchParams={changeSearchParams}
            action={installedActions}
            additionalControls={
              <ResourceMultiSelectMenu
                label="Source"
                icon="Layers"
                compact
                clearInFooter
                options={sourceFilterOptions}
                selectedValues={activeSourceFilters}
                onChange={(values) =>
                  changeSearchParams((next) => {
                    next.delete("source");
                    for (const value of values) next.append("source", value);
                  })
                }
              />
            }
          />
        }
      >
        <div className={cn("space-y-3", TOOLS_PAGE_BAND_CLASSES)}>
          {listQuery.isError ? (
            <ResourceListState
              state="error"
              message="Couldn't load plugins."
              onRetry={() => void listQuery.refetch()}
            />
          ) : listQuery.isFetching && listQuery.data === undefined ? (
            <ResourceListState state="loading" message="Loading plugins" />
          ) : plugins.length > 0 && visiblePlugins.length === 0 ? (
            <ResourceListState
              state="empty"
              message={
                normalizedInstalledQuery === ""
                  ? "No plugins match these filters."
                  : selectedCategories.length > 0 ||
                      activeSourceFilters.length > 0
                    ? `No plugins match "${installedQuery}" with these filters.`
                    : `No plugins match "${installedQuery}"`
              }
            />
          ) : (
            <>
              <InstalledPluginsTab
                plugins={installedList.items}
                onOpenPlugin={openPlugin}
              />
              <ResourceInfiniteScrollSentinel
                hasMore={installedList.hasMore}
                onLoadMore={installedList.loadMore}
              />
            </>
          )}
        </div>
      </ResourceCollectionViewport>
    );
  }

  return (
    <>
      {activeMode === "browse" ? (
        <div className="flex h-full min-h-0 flex-col">{content}</div>
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-5">
          <div className={cn("space-y-2", TOOLS_PAGE_BAND_CLASSES)}>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                Installed plugins
              </h1>
              {listQuery.data === undefined ? null : (
                <span className="rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground">
                  {plugins.length}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {PLUGINS_INSTALLED_DESCRIPTION}
            </p>
          </div>
          {content}
        </div>
      )}
      <PluginRemovalDialog removal={removal} />
      <AddPluginDialog
        open={addDialog.open}
        initial={addDialog.initial}
        onOpenChange={(open) =>
          setAddDialog((current) => ({ ...current, open }))
        }
        onInstalled={(plugin) =>
          navigate(
            getPluginDetailRoutePath({
              pluginId: plugin.id,
              view: "installed",
            }),
          )
        }
      />
    </>
  );
}
