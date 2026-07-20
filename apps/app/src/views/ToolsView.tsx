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
  ResourceDetailCollection,
  ResourceDetailFact,
  ResourceDetailFacts,
  ResourceDetailListItem,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { PluginsOverview } from "@/components/plugin/PluginsOverview";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { PluginSettingsDetail } from "@/components/plugin/PluginSettings";
import {
  PluginUpdateBanner,
  PluginUpdatesSourceCard,
  pluginHasUpdateSurfaces,
} from "@/components/plugin/management/PluginUpdatesCard";
import {
  pluginRuntimeStatusPresentation,
  type PluginRuntimeStatusPresentation,
} from "@/components/plugin/management/plugin-status";
import { PluginDetailView } from "@/components/tools/PluginDetailView";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { usePreferredTheme } from "@/hooks/useTheme";
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
  getAutomationsRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { SkillsLibrary } from "./SkillsView";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};
const HIGHLIGHTER_OPTIONS = {};

type ToolsSectionId = "skills" | "plugins" | "automations";

function getToolsSection(pathname: string): ToolsSectionId {
  if (pathname.startsWith(getPluginsRoutePath())) {
    return "plugins";
  }
  if (pathname.startsWith(getAutomationsRoutePath())) {
    return "automations";
  }
  return "skills";
}

function pluginSourceLabel(plugin: PluginListItem): string | null {
  if (plugin.provenance === "builtin") return "Built-in";
  if (plugin.provenance === "catalog") return "BB Official";
  if (plugin.source.startsWith("path:")) return "Local plugin";
  return "Direct install";
}

function pluginIsLocalSource(plugin: PluginListItem): boolean {
  return plugin.source.startsWith("path:");
}

function pluginCanBeRemoved(plugin: PluginListItem): boolean {
  return plugin.provenance !== "builtin";
}

function pluginRemovalLabel(plugin: PluginListItem): string {
  return pluginIsLocalSource(plugin) ? "Remove from bb" : "Uninstall";
}

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

function ToolsScrollPage({
  children,
  maxWidthClassName = "max-w-5xl",
}: {
  children: ReactNode;
  maxWidthClassName?: string;
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
            "mx-auto w-full space-y-4 px-4 pb-4 pt-3 md:px-5 md:pt-4",
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
}: {
  activeSection: ToolsSectionId;
  pluginId: string | undefined;
}) {
  if (activeSection === "skills") {
    return (
      <ToolsScrollPage>
        <SkillsLibrary />
      </ToolsScrollPage>
    );
  }
  if (activeSection === "plugins") {
    return <PluginsToolView pluginId={pluginId} />;
  }
  return <AutomationsToolView />;
}

function PluginListLogo({ plugin }: { plugin: PluginListItem }) {
  const theme = usePreferredTheme();
  const logoUrl =
    theme === "dark" && plugin.logoDarkUrl !== null
      ? plugin.logoDarkUrl
      : plugin.logoUrl;
  if (logoUrl !== null) {
    return (
      <img
        src={logoUrl}
        alt=""
        aria-hidden="true"
        className="size-4 shrink-0 rounded-sm object-contain"
      />
    );
  }
  return <BbMark />;
}

function BbMark({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src="/bb-mark.svg"
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:invert")}
    />
  );
}

function PluginsLoadingRows() {
  return <ResourceListState state="loading" message="Loading plugins" />;
}

function pluginActivityIcon(
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null,
): { name: IconName; className: string; label: string } {
  if (state === "running" || state === "ok") {
    return {
      name: "CircleCheck",
      className: "text-success",
      label: "Healthy",
    };
  }
  if (state === "backoff") {
    return {
      name: "AlertTriangle",
      className: "text-warning",
      label: "Retrying",
    };
  }
  if (state === "error") {
    return { name: "CircleX", className: "text-destructive", label: "Failed" };
  }
  if (state === null) {
    return {
      name: "Clock",
      className: "text-muted-foreground",
      label: "No runs yet",
    };
  }
  return {
    name: "Pause",
    className: "text-muted-foreground",
    label: "Stopped",
  };
}

function PluginActivityState({
  state,
  resourceLabel,
}: {
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null;
  resourceLabel: string;
}) {
  const icon = pluginActivityIcon(state);
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={`${resourceLabel}: ${icon.label}`}
            className="inline-flex"
          >
            <Icon
              name={icon.name}
              className={cn("size-4", icon.className)}
              aria-hidden
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{icon.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function pluginIncludes(plugin: PluginListItem): ReactNode[] {
  return [
    ...(plugin.app.hasApp
      ? [
          <ResourceDetailListItem
            key="app"
            leading={<Icon name="AppWindow" className="size-4" aria-hidden />}
          >
            App surfaces
          </ResourceDetailListItem>,
        ]
      : []),
    ...(plugin.cliCommand
      ? [
          <ResourceDetailListItem
            key="cli"
            leading={<Icon name="Terminal" className="size-4" aria-hidden />}
          >
            <span className="block font-mono">bb {plugin.cliCommand.name}</span>
            <span className="block text-xs text-muted-foreground">
              {plugin.cliCommand.summary}
            </span>
          </ResourceDetailListItem>,
        ]
      : []),
    ...plugin.services.map((service) => (
      <ResourceDetailListItem
        key={`service:${service.name}`}
        leading={<Icon name="Workflow" className="size-4" aria-hidden />}
      >
        <span className="block">{service.name}</span>
        <span className="block text-xs text-muted-foreground">
          Background service
        </span>
      </ResourceDetailListItem>
    )),
    ...plugin.schedules.map((schedule) => (
      <ResourceDetailListItem
        key={`schedule:${schedule.name}`}
        leading={<Icon name="TimeSchedule" className="size-4" aria-hidden />}
      >
        <span className="block">{schedule.name}</span>
        <span className="block font-mono text-xs text-muted-foreground">
          {schedule.cron}
        </span>
      </ResourceDetailListItem>
    )),
  ];
}

function PluginActivity({
  plugin,
  runtimeStatus,
}: {
  plugin: PluginListItem;
  runtimeStatus: PluginRuntimeStatusPresentation | null;
}) {
  const showOverallState = plugin.enabled && runtimeStatus !== null;
  const hasHandlerErrors = plugin.handlerStats.errorCount > 0;
  if (
    !showOverallState &&
    !hasHandlerErrors &&
    plugin.services.length === 0 &&
    plugin.schedules.length === 0
  ) {
    return null;
  }
  return (
    <ResourceDetailCollection>
      {showOverallState && runtimeStatus !== null ? (
        <ResourceDetailListItem
          leading={
            <Icon
              name={
                runtimeStatus.tone === "error" ? "CircleX" : "AlertTriangle"
              }
              className={cn(
                "size-4",
                runtimeStatus.tone === "error"
                  ? "text-destructive"
                  : "text-warning",
              )}
              aria-hidden
            />
          }
        >
          <span className="block">{runtimeStatus.label}</span>
          {plugin.statusDetail ? (
            <span className="block text-xs text-muted-foreground">
              {plugin.statusDetail}
            </span>
          ) : null}
          <span className="mt-1 block text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Next:</span>{" "}
            {runtimeStatus.recovery}
          </span>
        </ResourceDetailListItem>
      ) : null}
      {plugin.services.map((service) => (
        <ResourceDetailListItem
          key={service.name}
          leading={<Icon name="Workflow" className="size-4" aria-hidden />}
          trailing={
            <PluginActivityState
              state={service.state}
              resourceLabel={service.name}
            />
          }
        >
          <span className="block">{service.name}</span>
          <span className="block text-xs text-muted-foreground">
            Background service
          </span>
        </ResourceDetailListItem>
      ))}
      {plugin.schedules.map((schedule) => (
        <ResourceDetailListItem
          key={schedule.name}
          leading={<Icon name="TimeSchedule" className="size-4" aria-hidden />}
          trailing={
            <PluginActivityState
              state={schedule.lastStatus}
              resourceLabel={schedule.name}
            />
          }
        >
          <span className="block">{schedule.name}</span>
          {schedule.lastError ? (
            <span className="block text-xs text-destructive">
              {schedule.lastError}
            </span>
          ) : (
            <span className="block font-mono text-xs text-muted-foreground">
              {schedule.cron}
            </span>
          )}
        </ResourceDetailListItem>
      ))}
      {hasHandlerErrors ? (
        <ResourceDetailListItem
          leading={
            <Icon
              name="AlertCircle"
              className="size-4 text-destructive"
              aria-hidden
            />
          }
        >
          {plugin.handlerStats.errorCount} handler{" "}
          {plugin.handlerStats.errorCount === 1 ? "error" : "errors"}
        </ResourceDetailListItem>
      ) : null}
    </ResourceDetailCollection>
  );
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

  return <ToolsScrollPage>{mount}</ToolsScrollPage>;
}

export function PluginDetail({
  isLoading,
  plugin,
  pending,
  openSourceDisabled,
  onToggle,
  onReload,
  onEdit,
  onOpenSource,
  onDelete,
}: {
  isLoading: boolean;
  plugin: PluginListItem | null;
  pending: boolean;
  openSourceDisabled: boolean;
  onToggle: (plugin: PluginListItem) => void;
  onReload: (plugin: PluginListItem) => void;
  onEdit: (plugin: PluginListItem) => void;
  onOpenSource: (plugin: PluginListItem) => void;
  onDelete: (plugin: PluginListItem) => void;
}) {
  const { settingsSections } = usePluginSlots();
  if (isLoading) {
    return <PluginsLoadingRows />;
  }

  if (plugin === null) {
    return (
      <EmptyStatePanel className="py-6">Plugin not found.</EmptyStatePanel>
    );
  }

  const hasSettings =
    plugin.hasSettings ||
    settingsSections.some((section) => section.pluginId === plugin.id);
  const hasUpdateManagement = pluginHasUpdateSurfaces(plugin);
  const runtimeStatus = pluginRuntimeStatusPresentation(plugin);
  const sourceLabel = pluginSourceLabel(plugin);
  const includes = pluginIncludes(plugin);
  const hasActivity =
    (plugin.enabled && runtimeStatus !== null) ||
    plugin.handlerStats.errorCount > 0 ||
    plugin.services.length > 0 ||
    plugin.schedules.length > 0;
  const canEditSource = pluginIsLocalSource(plugin);
  const canRemove = pluginCanBeRemoved(plugin);

  return (
    <PluginDetailView
      leading={<PluginListLogo plugin={plugin} />}
      title={plugin.name ?? plugin.id}
      titleMeta={sourceLabel}
      metadata={
        <span className="block break-all font-mono">{plugin.rootDir}</span>
      }
      description={plugin.description}
      enabled={plugin.enabled}
      lifecycleDisabled={pending}
      onEnabledChange={() => onToggle(plugin)}
      overflowItems={[
        ...(canEditSource
          ? [
              {
                label: "Edit",
                icon: "Edit" as const,
                disabled: pending,
                onSelect: () => onEdit(plugin),
              },
              {
                label: "Open source",
                icon: "ExternalLink" as const,
                disabled: pending || openSourceDisabled,
                disabledReason: openSourceDisabled
                  ? "No editor configured"
                  : undefined,
                onSelect: () => onOpenSource(plugin),
              },
            ]
          : []),
        {
          label: "Reload",
          icon: "ArrowReloadHorizontal" as const,
          disabled: pending,
          onSelect: () => onReload(plugin),
        },
        ...(canRemove
          ? [
              { kind: "separator" as const },
              {
                label: pluginRemovalLabel(plugin),
                icon: "Trash2" as const,
                tone: "destructive" as const,
                disabled: pending,
                onSelect: () => onDelete(plugin),
              },
            ]
          : []),
      ]}
      definitionSections={[
        {
          label: "Release",
          kind: "release",
          content: (
            <div className="space-y-3">
              {hasUpdateManagement ? (
                <PluginUpdateBanner plugin={plugin} />
              ) : null}
              {hasUpdateManagement ? (
                <PluginUpdatesSourceCard
                  plugin={plugin}
                  showHeading={false}
                  embedded
                  releaseVersion={plugin.version}
                />
              ) : (
                <ResourceDetailFacts>
                  <ResourceDetailFact label="Version" mono>
                    {plugin.version}
                  </ResourceDetailFact>
                  <ResourceDetailFact label="Updates">
                    Included with bb releases
                  </ResourceDetailFact>
                </ResourceDetailFacts>
              )}
            </div>
          ),
        },
        ...(hasSettings
          ? [
              {
                label: "Settings",
                kind: "configuration" as const,
                content: <PluginSettingsDetail plugin={plugin} />,
              },
            ]
          : []),
        ...(includes.length > 0
          ? [
              {
                label: "Includes",
                kind: "includes" as const,
                content: (
                  <ResourceDetailCollection>
                    {includes}
                  </ResourceDetailCollection>
                ),
              },
            ]
          : []),
      ]}
      activitySections={
        hasActivity
          ? [
              {
                label: "Activity",
                content: (
                  <PluginActivity
                    plugin={plugin}
                    runtimeStatus={runtimeStatus}
                  />
                ),
              },
            ]
          : []
      }
    />
  );
}

function PluginsToolView({ pluginId }: { pluginId: string | undefined }) {
  return pluginId === undefined ? (
    <ToolsScrollPage>
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
      const response = await fetch(
        `/api/v1/plugins/${encodeURIComponent(plugin.id)}/${action}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(`Failed to ${action} plugin`);
    },
    onSuccess: () => listQuery.refetch(),
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const pluginReload = useMutation({
    mutationFn: async (plugin: PluginListItem) => {
      const response = await fetch(
        `/api/v1/plugins/reload?id=${encodeURIComponent(plugin.id)}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Failed to reload plugin");
    },
    onSuccess: () => {
      appToast.success("Plugin reloaded");
      return listQuery.refetch();
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : String(error));
    },
  });
  const pluginDelete = useMutation({
    mutationFn: async (plugin: PluginListItem) => {
      const response = await fetch(
        `/api/v1/plugins/${encodeURIComponent(plugin.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Failed to delete plugin");
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
  const pendingPluginId =
    pluginToggle.isPending && pluginToggle.variables
      ? pluginToggle.variables.id
      : pluginReload.isPending && pluginReload.variables
        ? pluginReload.variables.id
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
          onReload={(target) => pluginReload.mutate(target)}
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
  const activeSection = getToolsSection(location.pathname);

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<ToolsBodyFallback />}>
          <ToolsSectionBody activeSection={activeSection} pluginId={pluginId} />
        </Suspense>
      </div>
    </div>
  );
}
