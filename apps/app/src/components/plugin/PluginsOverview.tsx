import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  RESOURCE_GRID_PAGE_SIZE,
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionViewport,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
import { cn } from "@bb/shared-ui/lib/utils";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { Button } from "@bb/shared-ui/button";
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
import { PluginCollectionToolbar } from "@/components/plugin/management/PluginCollectionToolbar";
import { OpenPluginGuideButton } from "@/components/plugin/management/OpenPluginGuideButton";
import {
  mergePluginCollection,
  pluginCollectionCategory,
  pluginCollectionName,
} from "@/components/plugin/management/plugin-collection";
import {
  pluginBrowseSort,
  pluginBrowseSortDirection,
} from "@/components/plugin/management/PluginBrowseControls";
import { pluginRemovalDisabled } from "@/components/plugin/management/plugin-ui";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { usePluginListings } from "@/hooks/queries/plugin-listing-queries";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import {
  getPluginDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";

interface PluginsOverviewProps {
  mode?: "installed" | "browse";
  onOpenPlugin?: (pluginId: string, trigger: HTMLButtonElement) => void;
  onRemovePlugin?: (plugin: PluginListItem) => void;
}

export function PluginsOverview({
  onOpenPlugin,
  onRemovePlugin,
  mode,
}: PluginsOverviewProps = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const listQuery = usePluginList({ enabled: true });
  const listingQuery = usePluginListings();
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data?.plugins],
  );
  const collection = useMemo(
    () =>
      mergePluginCollection({
        plugins,
        listings: listingQuery.data?.records ?? [],
        catalogEntries: catalogQuery.data?.entries ?? [],
      }),
    [plugins, listingQuery.data?.records, catalogQuery.data?.entries],
  );
  const activeMode =
    mode ?? (searchParams.get("view") === "installed" ? "installed" : "browse");
  const authorKey = searchParams.get("author");
  const query = searchParams.get("query") ?? "";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const categories = searchParams.getAll("category");
  const requestedSort = pluginBrowseSort(searchParams.get("sort"));
  const hasInstallCounts = collection.some(
    (entry) => entry.catalogEntry?.installs != null,
  );
  const sort =
    requestedSort === "most-installed" && !hasInstallCounts
      ? null
      : requestedSort;
  const direction =
    pluginBrowseSortDirection(searchParams.get("direction")) ??
    (sort === null || sort === "name" ? "asc" : "desc");
  const categoryOptions = useMemo(
    () =>
      pluginCategoryFilterOptions(
        collection.map((entry) => {
          const category = pluginCollectionCategory(entry);
          return category.id === "uncategorized"
            ? {}
            : { categoryId: category.id, category: category.label };
        }),
        categories,
      ),
    [collection, categories],
  );
  const visibleEntries = useMemo(
    () =>
      collection
        .filter((entry) => {
          const category = pluginCollectionCategory(entry);
          if (categories.length > 0 && !categories.includes(category.id))
            return false;
          return [
            entry.pluginId,
            pluginCollectionName(entry),
            entry.runtime?.description,
            entry.runtime?.sourceDisplay,
            entry.runtime?.version,
            entry.listing?.entry.description,
            entry.listing?.entry.author.name,
            entry.catalogEntry?.author?.name,
            category.label,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery);
        })
        .sort((left, right) => {
          if (sort === null) {
            const enabledResult =
              Number(!left.runtime?.enabled) - Number(!right.runtime?.enabled);
            if (enabledResult !== 0) return enabledResult;
            if (left.runtime?.enabled) {
              const publisherResult =
                Number(left.runtime.publisherLabel === null) -
                Number(right.runtime?.publisherLabel === null);
              if (publisherResult !== 0) return publisherResult;
            }
          } else if (sort !== "name") {
            const leftValue =
              sort === "most-installed"
                ? (left.catalogEntry?.installs ?? null)
                : Date.parse(
                    left.catalogEntry?.publishedAt ??
                      left.listing?.entry.publishedAt ??
                      "",
                  );
            const rightValue =
              sort === "most-installed"
                ? (right.catalogEntry?.installs ?? null)
                : Date.parse(
                    right.catalogEntry?.publishedAt ??
                      right.listing?.entry.publishedAt ??
                      "",
                  );
            const leftKnown = leftValue !== null && Number.isFinite(leftValue);
            const rightKnown =
              rightValue !== null && Number.isFinite(rightValue);
            if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
            if (
              leftValue !== null &&
              rightValue !== null &&
              leftKnown &&
              rightKnown &&
              leftValue !== rightValue
            )
              return direction === "asc"
                ? leftValue - rightValue
                : rightValue - leftValue;
          }
          const result =
            pluginCollectionName(left).localeCompare(
              pluginCollectionName(right),
            ) || left.pluginId.localeCompare(right.pluginId);
          return sort === "name" && direction === "desc" ? -result : result;
        }),
    [collection, categories, normalizedQuery, sort, direction],
  );
  const installedList = useResourceInfiniteItems(visibleEntries, {
    pageSize: RESOURCE_GRID_PAGE_SIZE,
    resetKey: [
      normalizedQuery,
      sort,
      direction,
      [...categories].sort().join(","),
    ].join("\u0000"),
  });
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    initial: AddPluginInitial | null;
  }>({ open: false, initial: null });
  const openPlugin =
    onOpenPlugin ??
    ((pluginId: string) => {
      const params = new URLSearchParams(searchParams);
      if (activeMode === "installed") params.set("view", "installed");
      navigate({
        pathname: getPluginDetailRoutePath({ pluginId }),
        search: params.toString(),
      });
    });
  const onUninstall =
    onRemovePlugin === undefined
      ? undefined
      : (pluginId: string) => {
          const plugin = plugins.find((item) => item.id === pluginId);
          if (plugin !== undefined && !pluginRemovalDisabled(plugin))
            onRemovePlugin(plugin);
        };
  const startCreatePlugin = (prompt?: string) =>
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: prompt !== undefined,
      },
    });
  const installedActions = (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <OpenPluginGuideButton variant="secondary" />
      <CreateWithTemplatesButton
        kind="plugin"
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
    </span>
  );
  let content: ReactNode;
  if (activeMode === "browse") {
    content =
      authorKey === null ? (
        <BrowsePluginsTab
          onInstall={(initial) => setAddDialog({ open: true, initial })}
          onOpenPlugin={openPlugin}
          onUninstall={onUninstall}
          onInstallFromSource={() =>
            setAddDialog({ open: true, initial: null })
          }
        />
      ) : (
        <PluginAuthorPage
          authorKey={authorKey}
          onInstall={(initial) => setAddDialog({ open: true, initial })}
          onOpenPlugin={openPlugin}
          onUninstall={onUninstall}
        />
      );
  } else {
    content = (
      <ResourceCollectionViewport scrollId="plugins-installed-results">
        <div className={cn("space-y-6 pb-8", TOOLS_PAGE_BAND_CLASSES)}>
          <div className="space-y-2">
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
              Installed plugins
              <span
                className="rounded-md bg-muted px-2 py-1 text-2xs font-medium tabular-nums text-subtle-foreground"
                aria-label={`${collection.length} plugins in this collection`}
              >
                {collection.length.toLocaleString()}
              </span>
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Manage installed plugins and the plugins you create.
            </p>
          </div>
          <PluginCollectionToolbar
            categoryOptions={categoryOptions}
            hasInstallCounts={hasInstallCounts}
            action={installedActions}
            searchPlaceholder="Search installed plugins"
            additionalControls={
              plugins.length > 0 ? <CheckPluginUpdatesButton /> : null
            }
          />
          {listingQuery.isError ? (
            <p className="text-xs text-warning-text" role="status">
              Authored plugins are temporarily unavailable.
              <Button
                variant="link"
                size="sm"
                onClick={() => void listingQuery.refetch()}
              >
                Retry
              </Button>
            </p>
          ) : null}
          {listQuery.isError ? (
            <ResourceListState
              state="error"
              message="Couldn't load plugins."
              onRetry={() => void listQuery.refetch()}
            />
          ) : listQuery.isPending || listingQuery.isPending ? (
            <ResourceListState state="loading" message="Loading plugins" />
          ) : collection.length > 0 && visibleEntries.length === 0 ? (
            <ResourceListState
              state="empty"
              message={
                normalizedQuery === ""
                  ? "No plugins match these filters."
                  : `No plugins match "${query}"${categories.length > 0 ? " with these filters." : ""}`
              }
            />
          ) : (
            <>
              <InstalledPluginsTab
                entries={installedList.items}
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
      <div className="flex h-full min-h-0 flex-col">{content}</div>
      <AddPluginDialog
        open={addDialog.open}
        initial={addDialog.initial}
        onOpenChange={(open) =>
          setAddDialog((current) => ({ ...current, open }))
        }
        onInstalled={(plugin) =>
          navigate(
            `${getPluginDetailRoutePath({ pluginId: plugin.id })}${searchParams.size === 0 ? "" : `?${searchParams.toString()}`}`,
          )
        }
      />
    </>
  );
}
