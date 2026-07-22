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
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  getPluginDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";

type PluginsCollectionMode = "installed" | "browse";

function modeFromSearchParams(
  value: string | null,
  installationEnabled: boolean,
): PluginsCollectionMode {
  if (installationEnabled && value === "browse") return value;
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
  const systemConfig = useSystemConfig();
  const installationEnabled = systemConfig.data?.experiments.plugins === true;
  // Installed and builtin plugins remain visible even when installing new
  // plugins is disabled by the experiment.
  const listQuery = usePluginList({ enabled: true });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data],
  );
  const activeMode = modeFromSearchParams(
    searchParams.get("view"),
    installationEnabled,
  );
  const [installedQuery, setInstalledQuery] = useState("");
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
    ...(installationEnabled
      ? [{ id: "browse" as const, label: "Browse" }]
      : []),
  ];
  const normalizedInstalledQuery = installedQuery.trim().toLowerCase();
  const visiblePlugins = useMemo(
    () =>
      plugins
        .filter((plugin) => {
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
          const provenanceResult =
            Number(left.provenance !== "builtin") -
            Number(right.provenance !== "builtin");
          if (provenanceResult !== 0) return provenanceResult;
          const result = (left.name ?? left.id).localeCompare(
            right.name ?? right.id,
          );
          return installedSortDirection === "asc" ? result : -result;
        }),
    [installedSortDirection, normalizedInstalledQuery, plugins],
  );
  const installedPagination = useResourcePagination(visiblePlugins, {
    pageSize: installedPageSize,
    resetKey: [normalizedInstalledQuery, installedSortDirection].join("\u0000"),
  });
  const hasInstalledPagination =
    !listQuery.isError &&
    !(listQuery.isFetching && listQuery.data === undefined) &&
    installedPagination.total > installedPagination.pageSize;

  const changeMode = (mode: PluginsCollectionMode) => {
    if (!installationEnabled && mode === "browse") return;
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
      menuActions={
        installationEnabled
          ? [
              {
                label: "Install from source",
                icon: "Download",
                onSelect: () => setAddDialog({ open: true, initial: null }),
              },
            ]
          : []
      }
      onCreate={startCreatePlugin}
    />
  );

  let content: ReactNode;
  if (activeMode === "browse") {
    content = (
      <BrowsePluginsTab
        onInstall={(initial) => setAddDialog({ open: true, initial })}
        onOpenInstalled={(pluginId) =>
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
            message={`No plugins match "${installedQuery}"`}
          />
        ) : (
          <InstalledPluginsTab plugins={installedPagination.items} />
        )}
        {!installationEnabled && systemConfig.data !== undefined ? (
          <p className="px-1 text-2xs text-subtle-foreground">
            Browsing and installation are off. Turn on Plugins in Settings →
            Experiments to add plugins.
          </p>
        ) : null}
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
