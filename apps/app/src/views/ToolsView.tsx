import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  matchPath,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useMutation } from "@tanstack/react-query";
import { buildPluginEditThreadPrompt } from "@bb/shared-ui/resource-edit-prompt";
import { appToast } from "@/components/ui/app-toast";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import {
  ResourceListState,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { PluginsOverview } from "@/components/plugin/PluginsOverview";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  PluginDetail,
  pluginIsLocalSource,
  pluginRemovalLabel,
} from "@/components/tools/PluginDetail";
import {
  removePlugin,
  setPluginEnabled,
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  AUTOMATIONS_PLUGIN_ID,
  AUTOMATIONS_PLUGIN_PANEL_PATH,
  TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
  TOOLS_REGISTRY_SKILLS_ROUTE_PATH,
  TOOLS_SKILLS_ROUTE_PATH,
  getPluginsRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import {
  resolveToolsSection,
  type ToolsSectionId,
} from "@/components/tools/tools-navigation";
import { cn } from "@bb/shared-ui/lib/utils";
import { SkillsLibrary } from "./SkillsView";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};
const HIGHLIGHTER_OPTIONS = {};

export { PluginDetail };

function ToolsBodyFallback() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-2 md:px-5">
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-24 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function ToolsScrollPage({
  children,
  maxWidthClassName = "max-w-5xl",
  fillViewport = false,
}: {
  children: ReactNode;
  maxWidthClassName?: string;
  fillViewport?: boolean;
}) {
  const {
    scrollRef,
    topSentinelRef,
    bottomSentinelRef,
    aboveOverflow,
    belowOverflow,
  } = useScrollOverflowState<HTMLDivElement>({ measureOverflow: true });
  return (
    <div className="relative h-full overflow-hidden">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div ref={topSentinelRef} aria-hidden className="h-0" />
        <div
          className={cn(
            "mx-auto box-border min-h-full w-full space-y-4 px-4 pb-4 pt-3 md:px-5 md:pt-4",
            fillViewport && "h-full",
            maxWidthClassName,
          )}
        >
          {children}
        </div>
        <div ref={bottomSentinelRef} aria-hidden className="h-0" />
      </div>
      {aboveOverflow ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0">
          <OverflowFade placement="below" tone="background" />
        </div>
      ) : null}
      {belowOverflow ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0">
          <OverflowFade placement="above" tone="background" />
        </div>
      ) : null}
    </div>
  );
}

function ToolsSectionBody({
  activeSection,
  pluginId,
  pathname,
}: {
  activeSection: ToolsSectionId;
  pluginId: string | undefined;
  pathname: string;
}) {
  if (activeSection === "skills") {
    const isCollection =
      pathname === TOOLS_SKILLS_ROUTE_PATH ||
      pathname === TOOLS_REGISTRY_SKILLS_ROUTE_PATH;
    return (
      <ToolsScrollPage fillViewport={isCollection}>
        <SkillsLibrary />
      </ToolsScrollPage>
    );
  }
  if (activeSection === "plugins") {
    return <PluginsToolView pluginId={pluginId} />;
  }
  return <AutomationsToolView />;
}

function AutomationsToolView() {
  const location = useLocation();
  const { projectId, automationId } = useParams<{
    projectId?: string;
    automationId?: string;
  }>();
  const { navPanels } = usePluginSlots();
  const panel =
    navPanels.find(
      (candidate) =>
        candidate.pluginId === AUTOMATIONS_PLUGIN_ID &&
        candidate.path === AUTOMATIONS_PLUGIN_PANEL_PATH,
    ) ?? null;
  const subPath =
    projectId && automationId
      ? `${projectId}/${automationId}${
          matchPath(
            { path: TOOLS_AUTOMATION_EDIT_ROUTE_PATH, end: true },
            location.pathname,
          ) !== null
            ? "/edit"
            : ""
        }`
      : new URLSearchParams(location.search).get("view") === "browse"
        ? "browse"
        : "";
  if (panel === null) {
    return (
      <ToolsScrollPage maxWidthClassName="max-w-3xl">
        <EmptyStatePanel className="rounded-lg p-6 text-sm">
          Automations are still loading, or the automations plugin is not
          available.
        </EmptyStatePanel>
      </ToolsScrollPage>
    );
  }

  const slotMount = (
    <PluginSlotMount
      key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
      pluginId={panel.pluginId}
      slotKind="navPanel"
      slotId={panel.id}
    >
      <panel.component subPath={subPath} />
    </PluginSlotMount>
  );
  const mount =
    typeof Worker === "undefined" ? (
      slotMount
    ) : (
      <WorkerPoolContextProvider
        poolOptions={WORKER_POOL_OPTIONS}
        highlighterOptions={HIGHLIGHTER_OPTIONS}
      >
        {slotMount}
      </WorkerPoolContextProvider>
    );

  // No `ToolsScrollPage` here: the automations panel is a plugin nav panel, and
  // nav panels own their page padding, max width, and scrolling so they render
  // the same on this route and on the /plugins panel route. Wrapping it again
  // would double the page padding.
  return <div className="relative h-full overflow-hidden">{mount}</div>;
}

function PluginsToolView({ pluginId }: { pluginId: string | undefined }) {
  return pluginId === undefined ? (
    <ToolsScrollPage fillViewport>
      <PluginsOverview />
    </ToolsScrollPage>
  ) : (
    <PluginDetailToolView pluginId={pluginId} />
  );
}

function PluginDetailToolView({ pluginId }: { pluginId: string }) {
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<PluginListItem | null>(null);
  const listQuery = usePluginList({ enabled: true });
  const plugins = useMemo(
    () => listQuery.data?.plugins ?? [],
    [listQuery.data],
  );
  const {
    canOpenPreferredDirectoryTarget,
    openPathInPreferredDirectoryTarget,
  } = useLocalOpenTargets({
    enabled: plugins.some(
      (plugin) => pluginIsLocalSource(plugin) && plugin.rootDir !== null,
    ),
  });
  const pluginToggle = useMutation({
    mutationFn: async (plugin: PluginListItem) => {
      const action = plugin.enabled ? "disable" : "enable";
      try {
        await setPluginEnabled(fetch, plugin.id, !plugin.enabled);
      } catch {
        throw new Error(`Failed to ${action} plugin`);
      }
    },
    onSuccess: () => listQuery.refetch(),
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const pluginDelete = useMutation({
    mutationFn: async (plugin: PluginListItem) => {
      try {
        await removePlugin(fetch, plugin.id);
      } catch {
        throw new Error("Failed to delete plugin");
      }
    },
    onSuccess: (_data, deletedPlugin) => {
      appToast.success(
        pluginIsLocalSource(deletedPlugin)
          ? "Plugin removed from bb"
          : "Plugin uninstalled",
      );
      setDeleteTarget(null);
      navigate(getPluginsRoutePath());
      return listQuery.refetch();
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const isLoading = listQuery.isFetching && listQuery.data === undefined;
  const selectedPlugin =
    plugins.find((plugin) => plugin.id === pluginId) ?? null;
  useResourceRouteLabel(selectedPlugin?.name ?? selectedPlugin?.id ?? null);
  const pendingPluginId =
    pluginToggle.isPending && pluginToggle.variables
      ? pluginToggle.variables.id
      : pluginDelete.isPending && pluginDelete.variables
        ? pluginDelete.variables.id
        : null;
  const handleEditPlugin = useCallback(
    (plugin: PluginListItem) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: buildPluginEditThreadPrompt({
            name: plugin.name ?? plugin.id,
            path: plugin.rootDir,
          }),
          replaceInitialPrompt: true,
        },
      });
    },
    [navigate],
  );
  const handleOpenPluginSource = useCallback(
    (plugin: PluginListItem) => {
      if (!canOpenPreferredDirectoryTarget) return;
      void openPathInPreferredDirectoryTarget({
        path: plugin.rootDir,
        lineNumber: null,
      });
    },
    [canOpenPreferredDirectoryTarget, openPathInPreferredDirectoryTarget],
  );

  return (
    <ToolsScrollPage>
      {listQuery.isError ? (
        <ResourceListState
          state="error"
          message="Couldn't load plugin."
          onRetry={() => void listQuery.refetch()}
        />
      ) : (
        <PluginDetail
          isLoading={isLoading}
          plugin={selectedPlugin}
          pending={
            selectedPlugin !== null && pendingPluginId === selectedPlugin.id
          }
          openSourceDisabled={!canOpenPreferredDirectoryTarget}
          onToggle={(target) => pluginToggle.mutate(target)}
          onEdit={handleEditPlugin}
          onOpenSource={handleOpenPluginSource}
          onDelete={setDeleteTarget}
        />
      )}
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !pluginDelete.isPending) setDeleteTarget(null);
        }}
      >
        {deleteTarget ? (
          <ConfirmDeleteDialogContent
            title={
              pluginIsLocalSource(deleteTarget)
                ? "Remove plugin from bb?"
                : "Uninstall plugin?"
            }
            description={
              pluginIsLocalSource(deleteTarget)
                ? `Remove "${deleteTarget.id}" from bb? Its source files will stay on disk.`
                : `Uninstall "${deleteTarget.id}" and delete its managed files and settings?`
            }
            confirmLabel={pluginRemovalLabel(deleteTarget)}
            pending={pluginDelete.isPending}
            onConfirm={() => pluginDelete.mutate(deleteTarget)}
            onCancel={() => setDeleteTarget(null)}
          />
        ) : null}
      </ConfirmDeleteDialog>
    </ToolsScrollPage>
  );
}

export function ToolsView() {
  const location = useLocation();
  const { pluginId } = useParams<{
    pluginId?: string;
  }>();
  const activeSection = resolveToolsSection(location.pathname);

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<ToolsBodyFallback />}>
          <ToolsSectionBody
            activeSection={activeSection}
            pluginId={pluginId}
            pathname={location.pathname}
          />
        </Suspense>
      </div>
    </div>
  );
}
