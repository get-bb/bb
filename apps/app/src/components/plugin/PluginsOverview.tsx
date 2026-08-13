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
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
import { isOfficialProvenance } from "@/components/plugin/plugin-provenance";
import { PLUGINS_INSTALLED_DESCRIPTION } from "@/components/plugin/plugins-collection-copy";
import {
  usePluginList,
  type PluginProvenance,
} from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";

type PluginsCollectionMode = "installed" | "browse";

/** Where an installed plugin came from, as the collection filter presents it. */
type PluginTypeFilter = "bb-official" | "user";

const PLUGIN_TYPE_FILTERS: readonly PluginTypeFilter[] = [
  "bb-official",
  "user",
];

const PLUGIN_TYPE_FILTER_OPTIONS = PLUGIN_TYPE_FILTERS.map((type) => ({
  id: type,
  label: type === "bb-official" ? "BB Official" : "User",
}));

function pluginTypeFilterId(provenance: PluginProvenance): PluginTypeFilter {
  return isOfficialProvenance(provenance) ? "bb-official" : "user";
}

// Membership, not repeated literals: a new entry in PLUGIN_TYPE_FILTERS is
// selectable the moment it renders instead of being silently dropped here.
function isPluginTypeFilter(value: string): value is PluginTypeFilter {
  return PLUGIN_TYPE_FILTERS.some((filter) => filter === value);
}

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
  const installedPageSize = useResourceViewportPageSize(installedViewport);
  const [installedSortDirection, setInstalledSortDirection] = useState<
    "asc" | "desc"
  >("asc");
  // Empty means unfiltered: the menu has no explicit "All" row.
  const [typeFilters, setTypeFilters] = useState<PluginTypeFilter[]>([]);
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    initial: AddPluginInitial | null;
  }>({ open: false, initial: null });

  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const visiblePlugins = useMemo(
    () =>
      plugins
        .filter((plugin) => {
          if (
            typeFilters.length > 0 &&
            !typeFilters.includes(pluginTypeFilterId(plugin.provenance))
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
            const leftOfficial = isOfficialProvenance(left.provenance);
            const rightOfficial = isOfficialProvenance(right.provenance);
            const provenanceResult =
              Number(!leftOfficial) - Number(!rightOfficial);
            if (provenanceResult !== 0) return provenanceResult;
          }
          const result = (left.name ?? left.id).localeCompare(
            right.name ?? right.id,
          );
          if (result !== 0) {
            return installedSortDirection === "asc" ? result : -result;
          }
          return left.id.localeCompare(right.id);
        }),
    [installedSortDirection, normalizedInstalledQuery, plugins, typeFilters],
  );
  // Pages load as the sentinel scrolls into view; the page machinery stays
  // (viewport-fit chunk size, projection reset keys) but rows accumulate.
  const installedList = useResourceInfiniteItems(visiblePlugins, {
    pageSize: installedPageSize,
    resetKey: [
      normalizedInstalledQuery,
      installedSortDirection,
      [...typeFilters].sort().join(","),
    ].join("\u0000"),
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
  // row. Installed keeps the New plugin button, which starts a thread.
  const installedActions = (
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
                  selectedValues={typeFilters}
                  options={PLUGIN_TYPE_FILTER_OPTIONS}
                  onChange={(values) =>
                    setTypeFilters(values.filter(isPluginTypeFilter))
                  }
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
                  : typeFilters.length > 0
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
