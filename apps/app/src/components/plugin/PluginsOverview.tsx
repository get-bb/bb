import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { CREATE_PLUGIN_PROMPT } from "@/lib/create-resource-prompts";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "@/components/plugin/management/BrowsePluginsTab";
import { CheckPluginUpdatesButton } from "@/components/plugin/management/CheckPluginUpdatesButton";
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
import {
  pluginPublisherFilterId,
  pluginPublisherFilterOptions,
} from "@/components/plugin/plugin-provenance";
import { PLUGINS_INSTALLED_DESCRIPTION } from "@/components/plugin/plugins-collection-copy";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";

type PluginsCollectionMode = "installed" | "browse";

function modeFromSearchParams(value: string | null): PluginsCollectionMode {
  if (value === "installed") return value;
  return "browse";
}

/**
 * The canonical Plugins collection: installed resources, discoverable
 * resources from BB's official catalog.
 * Modes are URL-backed projections of one collection, not separate settings
 * pages; plugin configuration and lifecycle depth remain on the detail route.
 */
export function PluginsOverview() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const listQuery = usePluginList({ enabled: true });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data?.plugins],
  );
  const activeMode = modeFromSearchParams(searchParams.get("view"));
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedViewport, setInstalledViewport] =
    useState<HTMLDivElement | null>(null);
  const [installedSortDirection, setInstalledSortDirection] = useState<
    "asc" | "desc"
  >("asc");
  // Empty means unfiltered: the menu has no explicit "All" row.
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  // Facets follow the installed plugins, so adding a marketplace adds its
  // facet. Uninstalling the last plugin of one removes its facet too, and the
  // selection is intersected with what is on offer rather than kept: a
  // vanished facet would otherwise filter the list to nothing with no row left
  // in the menu to switch it back off.
  const typeFilterOptions = useMemo(
    () => pluginPublisherFilterOptions(plugins),
    [plugins],
  );
  const activeTypeFilters = useMemo(() => {
    const offered = new Set(typeFilterOptions.map((option) => option.id));
    return typeFilters.filter((value) => offered.has(value));
  }, [typeFilterOptions, typeFilters]);
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  // One projection identity resets both the accumulated rows and their
  // viewport measurement when search, filters, or sorting changes.
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
            // Published plugins first, then the user's own; publishers
            // themselves stay in one alphabetical run so the sort direction
            // still controls the whole list.
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
  // Pages load as the sentinel scrolls into view; the page machinery stays
  // (viewport-fit chunk size, projection reset keys) but rows accumulate.
  const installedList = useResourceInfiniteItems(visiblePlugins, {
    pageSize: installedPageSize,
    resetKey: installedResetKey,
  });

  // Installed's New plugin goes to the real new-thread page: the inline hero
  // composer is Browse's own affordance, and bouncing Installed users through
  // Browse read as a mis-navigation rather than a shortcut.
  const startCreatePlugin = (prompt?: string) => {
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: prompt !== undefined,
      },
    });
  };

  // Browse renders no page shell at all — its actions live in the hero's CTA
  // row. Installed keeps the New plugin button, which starts a thread, plus
  // an on-demand update check beside it (the server also sweeps every 6h).
  const installedActions = (
    <>
      {plugins.length > 0 ? <CheckPluginUpdatesButton /> : null}
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
    </>
  );

  let content: ReactNode;
  if (activeMode === "browse") {
    content = (
      <BrowsePluginsTab
        onInstall={(initial) => setAddDialog({ open: true, initial })}
        onOpenPlugin={(pluginId) =>
          navigate(getPluginDetailRoutePath({ pluginId }))
        }
        onInstallFromSource={() => setAddDialog({ open: true, initial: null })}
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

  // Browse and Installed are separate top-nav destinations now, not tabs:
  // Browse is the full-bleed discovery page (its description lives in the
  // hero), while Installed keeps the collection shell for its description and
  // actions row.
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
