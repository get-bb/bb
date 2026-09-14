import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
  RESOURCE_GRID_PAGE_SIZE,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import {
  BrowsePluginsTab,
  pluginCategoryFilterOptions,
} from "@/components/plugin/management/BrowsePluginsTab";
import { CheckPluginUpdatesButton } from "@/components/plugin/management/CheckPluginUpdatesButton";
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
import { PluginAuthorPage } from "@/components/plugin/management/PluginAuthorPage";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import { installedPluginCatalogEntry } from "./management/installed-plugin-catalog";
import {
  PluginCollectionToolbar,
  pluginBrowseSort,
  pluginBrowseSortDirection,
} from "./management/PluginBrowseControls";
import {
  pluginCategoryFilterId,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const listQuery = usePluginList({ enabled: true });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data?.plugins],
  );
  const activeMode =
    mode ?? (searchParams.get("view") === "installed" ? "installed" : "browse");
  const authorKey = searchParams.get("author");
  const installedQuery = searchParams.get("query") ?? "";
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
  const selectedCategories = searchParams.getAll("category");
  const categoryOptions = useMemo(
    () => pluginCategoryFilterOptions(installedEntries, selectedCategories),
    [installedEntries, selectedCategories],
  );
  const installsKnown = installedEntries.some(
    (entry) => entry.installs !== null,
  );
  const requestedSort = pluginBrowseSort(searchParams.get("sort"));
  const installedSort =
    requestedSort === "most-installed" && !installsKnown ? null : requestedSort;
  const installedSortDirection =
    pluginBrowseSortDirection(searchParams.get("direction")) ??
    (installedSort === "name" ? "asc" : "desc");
  const changeSearchParams = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next, { replace: true });
  };
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const installedResetKey = [
    normalizedInstalledQuery,
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

  let content: ReactNode;
  if (activeMode === "browse") {
    const openPlugin =
      onOpenPlugin ??
      ((pluginId: string) => navigate(getPluginDetailRoutePath({ pluginId })));
    content =
      authorKey === null ? (
        <BrowsePluginsTab
          onInstall={(initial) => setAddDialog({ open: true, initial })}
          onOpenPlugin={openPlugin}
          onInstallFromSource={() =>
            setAddDialog({ open: true, initial: null })
          }
        />
      ) : (
        <PluginAuthorPage
          authorKey={authorKey}
          onInstall={(initial) => setAddDialog({ open: true, initial })}
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
              plugins.length > 0 ? <CheckPluginUpdatesButton /> : null
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
                  : selectedCategories.length > 0
                    ? `No plugins match "${installedQuery}" with these filters.`
                    : `No plugins match "${installedQuery}"`
              }
            />
          ) : (
            <>
              <InstalledPluginsTab plugins={installedList.items} />
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
        <ResourceCollectionPage
          id="plugins-collection"
          description={PLUGINS_INSTALLED_DESCRIPTION}
          bandClassName={TOOLS_PAGE_BAND_CLASSES}
        >
          {content}
        </ResourceCollectionPage>
      )}
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
