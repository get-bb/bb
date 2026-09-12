import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import {
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
  useResourceViewportPageSize,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceListState,
  ResourceMultiSelectMenu,
  ResourceSortMenu,
  ResourceToolbar,
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
  pluginPublisherFilterId,
  pluginPublisherFilterOptions,
} from "@/components/plugin/plugin-provenance";
import { PLUGINS_INSTALLED_DESCRIPTION } from "@/components/plugin/plugins-collection-copy";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { usePluginUpdateCheck } from "@/hooks/queries/plugin-catalog-queries";
import {
  getPluginDetailRoutePath,
  getPluginsRoutePath,
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
  const [searchParams] = useSearchParams();
  const listQuery = usePluginList({ enabled: true });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data?.plugins],
  );
  const activeMode =
    mode ?? (searchParams.get("view") === "installed" ? "installed" : "browse");
  const updateCheck = usePluginUpdateCheck({
    enabled: activeMode === "installed" && plugins.length > 0,
  });
  const authorKey = searchParams.get("author");
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedViewport, setInstalledViewport] =
    useState<HTMLDivElement | null>(null);
  const [installedSortDirection, setInstalledSortDirection] = useState<
    "asc" | "desc"
  >("asc");
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const typeFilterOptions = useMemo(
    () => pluginPublisherFilterOptions(plugins),
    [plugins],
  );
  const activeTypeFilters = useMemo(() => {
    const offered = new Set(typeFilterOptions.map((option) => option.id));
    return typeFilters.filter((value) => offered.has(value));
  }, [typeFilterOptions, typeFilters]);
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const installedResetKey = [
    normalizedInstalledQuery,
    installedSortDirection,
    [...activeTypeFilters].sort().join(","),
  ].join("\u0000");
  const installedPageSize = useResourceViewportPageSize(installedViewport, {
    resetKey: installedResetKey,
  });
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    initial: AddPluginInitial | null;
  }>({ open: false, initial: null });

  const visiblePlugins = useMemo(
    () =>
      plugins
        .filter((plugin) => {
          if (
            activeTypeFilters.length > 0 &&
            !activeTypeFilters.includes(pluginPublisherFilterId(plugin))
          ) {
            return false;
          }
          if (normalizedInstalledQuery.length === 0) return true;
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
        })
        .sort((left, right) => {
          const enabledResult = Number(!left.enabled) - Number(!right.enabled);
          if (enabledResult !== 0) return enabledResult;
          if (left.enabled) {
            const leftPublisher = left.publisherLabel;
            const rightPublisher = right.publisherLabel;
            const publisherResult =
              Number(leftPublisher === null) - Number(rightPublisher === null);
            if (publisherResult !== 0) return publisherResult;
          }
          const result = (left.name ?? left.id).localeCompare(
            right.name ?? right.id,
          );
          if (result !== 0) {
            return installedSortDirection === "asc" ? result : -result;
          }
          return left.id.localeCompare(right.id);
        }),
    [
      activeTypeFilters,
      installedSortDirection,
      normalizedInstalledQuery,
      plugins,
    ],
  );
  const installedList = useResourceInfiniteItems(visiblePlugins, {
    pageSize: installedPageSize,
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
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-8 px-0 sm:w-auto sm:px-3"
            >
              <Link to={getPluginsRoutePath()}>
                <Icon name="Explore" className="size-4 sm:hidden" aria-hidden />
                <span className="sr-only sm:not-sr-only">Browse marketplace</span>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="sm:hidden">
            Browse marketplace
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <CreateWithTemplatesButton
        kind="plugin"
        label="New plugin"
        compactOnMobile
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
        viewportRef={setInstalledViewport}
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
        toolbar={
          <ResourceToolbar
            wrap={false}
            searchValue={installedQuery}
            searchPlaceholder="Search installed plugins"
            onSearchChange={setInstalledQuery}
            action={installedActions}
            controls={
              <>
                <ResourceMultiSelectMenu
                  label="Type"
                  icon="SlidersHorizontal"
                  compact
                  selectedValues={activeTypeFilters}
                  options={typeFilterOptions}
                  onChange={setTypeFilters}
                />
                <ResourceSortMenu
                  value="alpha"
                  direction={installedSortDirection}
                  compact
                  options={[{ id: "alpha", label: "Plugin name" }]}
                  onChange={() =>
                    setInstalledSortDirection((current) =>
                      current === "asc" ? "desc" : "asc",
                    )
                  }
                />
              </>
            }
          />
        }
      >
        <div className={cn("space-y-3", TOOLS_PAGE_BAND_CLASSES)}>
          {updateCheck.isError && !listQuery.isError && plugins.length > 0 ? (
            <ResourceListState
              state="error"
              message="Couldn't check for plugin updates."
              onRetry={() => void updateCheck.refetch()}
            />
          ) : null}
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
                  : activeTypeFilters.length > 0
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
