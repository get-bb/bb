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
  ResourceSortMenu,
  ResourceToolbar,
  type ResourceCollectionMode,
} from "@bb/shared-ui/resource-list";
import {
  CREATE_PLUGIN_PROMPT,
  CreateWithTemplatesButton,
} from "@/components/create-via-prompt-examples";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "@/components/plugin/management/BrowsePluginsTab";
import { InstalledPluginsTab } from "@/components/plugin/management/InstalledPluginsTab";
import { PluginCategoryFilterPills } from "@/components/plugin/management/PluginCategoryFilterPills";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import {
  getPluginDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";

type PluginsCollectionMode = "installed" | "browse";

function modeFromSearchParams(value: string | null): PluginsCollectionMode {
  if (value === "browse") return value;
  return "installed";
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
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  const plugins = listQuery.data?.plugins ?? [];
  const activeMode = modeFromSearchParams(searchParams.get("view"));
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedCategory, setInstalledCategory] = useState<string | null>(
    null,
  );
  const [installedViewport, setInstalledViewport] =
    useState<HTMLDivElement | null>(null);
  const installedPageSize = useResourceViewportPageSize(installedViewport);
  const [installedSortDirection, setInstalledSortDirection] = useState<
    "asc" | "desc"
  >("asc");
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    initial: AddPluginInitial | null;
  }>({ open: false, initial: null });

  const modes: readonly ResourceCollectionMode<PluginsCollectionMode>[] = [
    {
      id: "installed",
      label: "Installed",
      count: plugins.length,
      accessibleLabel: `Installed, ${plugins.length} ${
        plugins.length === 1 ? "plugin" : "plugins"
      }`,
    },
    { id: "browse" as const, label: "Browse" },
  ];
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const categoryByPluginId = useMemo(() => {
    const categories = new Map<string, string>();
    for (const entry of catalogQuery.data ?? []) {
      categories.set(entry.entryId, entry.category);
      categories.set(entry.pluginId, entry.category);
    }
    return categories;
  }, [catalogQuery.data]);
  const installedCategories = useMemo(() => {
    const categories: string[] = [];
    for (const entry of catalogQuery.data ?? []) {
      if (!categories.includes(entry.category)) {
        categories.push(entry.category);
      }
    }
    if (
      installedCategory !== null &&
      !categories.includes(installedCategory)
    ) {
      categories.push(installedCategory);
    }
    return categories;
  }, [catalogQuery.data, installedCategory]);
  const visiblePlugins = useMemo(
    () =>
      plugins
        .filter((plugin) => {
          if (installedCategory !== null) {
            const category =
              (plugin.catalogEntryId === null
                ? undefined
                : categoryByPluginId.get(plugin.catalogEntryId)) ??
              categoryByPluginId.get(plugin.id);
            if (category !== installedCategory) return false;
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
            const leftOfficial =
              left.provenance === "builtin" || left.provenance === "catalog";
            const rightOfficial =
              right.provenance === "builtin" || right.provenance === "catalog";
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
    [
      categoryByPluginId,
      installedCategory,
      installedSortDirection,
      normalizedInstalledQuery,
      plugins,
    ],
  );
  const installedPagination = useResourcePagination(visiblePlugins, {
    pageSize: installedPageSize,
    resetKey: [
      normalizedInstalledQuery,
      installedCategory ?? "all",
      installedSortDirection,
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
        if (mode === "installed") next.delete("view");
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
            containedControls
            controls={
              <ResourceSortMenu
                value="alpha"
                direction={installedSortDirection}
                options={[{ id: "alpha", label: "Plugin name" }]}
                onChange={() =>
                  setInstalledSortDirection((current) =>
                    current === "asc" ? "desc" : "asc",
                  )
                }
              />
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
        <PluginCategoryFilterPills
          categories={installedCategories}
          value={installedCategory}
          onValueChange={setInstalledCategory}
        />
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
              installedCategory === null
                ? `No plugins match "${installedQuery}"`
                : `No installed plugins match ${installedCategory}.`
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
