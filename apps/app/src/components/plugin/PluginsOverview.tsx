import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ResourcePagination,
  useResourcePagination,
  useResourceViewportPageSize,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceListState,
  ResourceMultiSelectMenu,
  ResourceSortMenu,
  ResourceToolbar,
  type ResourceCollectionMode,
} from "@bb/shared-ui/resource-list";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { CREATE_PLUGIN_PROMPT } from "@/lib/create-resource-prompts";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "@/components/plugin/management/BrowsePluginsTab";
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
import { isOfficialProvenance } from "@/components/plugin/plugin-provenance";
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
  const [searchParams, setSearchParams] = useSearchParams();
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

  const modes: readonly ResourceCollectionMode<PluginsCollectionMode>[] = [
    { id: "browse" as const, label: "Browse" },
    {
      id: "installed",
      label: "Installed",
      count: plugins.length,
      accessibleLabel: `Installed, ${plugins.length} ${
        plugins.length === 1 ? "plugin" : "plugins"
      }`,
    },
  ];
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
  const installedPagination = useResourcePagination(visiblePlugins, {
    pageSize: installedPageSize,
    resetKey: [
      normalizedInstalledQuery,
      installedSortDirection,
      [...typeFilters].sort().join(","),
    ].join("\u0000"),
  });
  const hasInstalledPagination =
    !listQuery.isError &&
    !(listQuery.isFetching && listQuery.data === undefined) &&
    installedPagination.total > installedPagination.pageSize;

  const changeMode = (mode: PluginsCollectionMode) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (mode === "browse") next.delete("view");
        else next.set("view", mode);
        return next;
      },
      { replace: false },
    );
  };
  const startCreatePlugin = (prompt?: string) =>
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: true,
        createDraftKind: "plugin",
      },
    });

  const actions = (
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
      />
    );
  } else {
    content = (
      <ResourceCollectionViewport
        scrollId="plugins-installed-results"
        viewportRef={setInstalledViewport}
        toolbar={
          <ResourceToolbar
            searchValue={installedQuery}
            searchPlaceholder="Search installed plugins"
            onSearchChange={setInstalledQuery}
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
        footer={
          hasInstalledPagination ? (
            <ResourcePagination
              page={installedPagination.page}
              pageSize={installedPagination.pageSize}
              total={installedPagination.total}
              visibleCount={installedPagination.visibleCount}
              onPageChange={installedPagination.setPage}
              scrollTargetId="plugins-installed-results"
            />
          ) : undefined
        }
        contentClassName="space-y-3"
      >
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
          <InstalledPluginsTab plugins={installedPagination.items} />
        )}
      </ResourceCollectionViewport>
    );
  }

  return (
    <ResourceCollectionPage
      id="plugins-collection"
      description="Customize bb with plugins. Plugins can add app surfaces, commands, services, schedules, and skills."
      modes={modes}
      activeMode={activeMode}
      onModeChange={changeMode}
      actions={actions}
    >
      {content}
      <AddPluginDialog
        open={addDialog.open}
        initial={addDialog.initial}
        onOpenChange={(open) =>
          setAddDialog((current) => ({ ...current, open }))
        }
        onInstalled={(plugin) =>
          navigate(getPluginDetailRoutePath({ pluginId: plugin.id }))
        }
      />
    </ResourceCollectionPage>
  );
}
