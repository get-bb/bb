import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PluginSettingsPage } from "@/components/plugin/PluginSettings";
import { usePluginListings } from "@/hooks/queries/plugin-listing-queries";
import { AuthoredPluginDetail } from "@/components/plugin/management/AuthoredPluginDetail";
import { PluginListingActions } from "@/components/plugin/management/PluginListingActions";
import { PluginListingNotices } from "@/components/plugin/management/PluginListingNotices";
import { pluginWorkspaceAtom } from "@/components/plugin/plugin-workspace-state";
import {
  PluginRemovalDialog,
  usePluginRemoval,
} from "@/components/plugin/management/usePluginRemoval";
import "@bb/shared-ui/icon-extended";
import { useMutation } from "@tanstack/react-query";
import { buildPluginEditThreadPrompt } from "@bb/shared-ui/resource-edit-prompt";
import { appToast } from "@/components/ui/app-toast";
import { OverflowFade } from "@/components/ui/overflow-fade";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import { AddPluginDialog } from "@/components/plugin/management/AddPluginDialog";
import {
  ResourceListState,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { PluginsOverview } from "@/components/plugin/PluginsOverview";
import {
  CatalogPluginDetail,
  CatalogPluginDetailBanner,
  PluginDetail,
  PluginDetailBanners,
  pluginIsLocalSource,
} from "@/components/tools/PluginDetail";
import {
  usePluginCatalogSearch,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import {
  setPluginEnabled,
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import {
  REGISTRY_SKILLS_ROUTE_PATH,
  SKILLS_ROUTE_PATH,
  getPluginDetailRoutePath,
  getPluginsRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { SkillsLibrary } from "@/components/tools/SkillsLibrary";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  SecondaryPanelLayout,
  type SecondaryPanelRenderArgs,
} from "@/components/secondary-panel/SecondaryPanelLayout";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import type {
  SecondaryPanelRenderableTab,
  SecondaryPanelTabReorderHandler,
} from "@/components/secondary-panel/secondaryPanelTab";

function ResourceBodyFallback() {
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

function ResourceScrollPage({
  children,
  fillViewport = false,
}: {
  children: ReactNode;
  fillViewport?: boolean;
}) {
  const {
    scrollRef,
    topSentinelRef,
    bottomSentinelRef,
    aboveOverflow,
    belowOverflow,
  } = useScrollOverflowState<HTMLDivElement>({ measureOverflow: true });
  if (fillViewport) {
    return (
      <div className="box-border h-full w-full pb-4 pt-3 md:pt-4">
        {children}
      </div>
    );
  }
  return (
    <div className="relative h-full overflow-hidden">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <div ref={topSentinelRef} aria-hidden className="h-0" />
        <div
          className={cn(
            "mx-auto box-border min-h-full w-full space-y-4 px-4 pb-4 pt-3 md:px-5 md:pt-4",
            "max-w-5xl",
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

interface PluginsToolViewProps {
  onOpenPlugin: (pluginId: string, trigger: HTMLButtonElement) => void;
  onRemovePlugin: (plugin: PluginListItem) => void;
}

function PluginsToolView({
  onOpenPlugin,
  onRemovePlugin,
}: PluginsToolViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PluginListingNotices />
      <div className="min-h-0 flex-1">
        <ResourceScrollPage fillViewport>
          <PluginsOverview
            onOpenPlugin={onOpenPlugin}
            onRemovePlugin={onRemovePlugin}
          />
        </ResourceScrollPage>
      </div>
    </div>
  );
}

function PluginDetailToolView({ pluginId }: { pluginId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const removal = usePluginRemoval();
  const configurationOpen =
    new URLSearchParams(location.search).get("configure") === pluginId;
  const setConfigurationOpen = useCallback(
    (open: boolean) => {
      const params = new URLSearchParams(location.search);
      if (open) params.set("configure", pluginId);
      else params.delete("configure");
      navigate({ pathname: location.pathname, search: params.toString() });
    },
    [location.pathname, location.search, navigate, pluginId],
  );
  const [installTarget, setInstallTarget] =
    useState<PluginCatalogSearchEntry | null>(null);
  const listQuery = usePluginList({ enabled: true });
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  const listings = usePluginListings();
  const listing =
    listings.data?.records.find((record) => record.pluginId === pluginId) ??
    null;
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
    meta: { showErrorToast: false },
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
  const isLoading = listQuery.isFetching && listQuery.data === undefined;
  const selectedPlugin =
    plugins.find((plugin) => plugin.id === pluginId) ?? null;
  const selectedCatalogEntry =
    catalogQuery.data?.entries.find((entry) => entry.pluginId === pluginId) ??
    null;
  useResourceRouteLabel(
    selectedPlugin?.name ??
      selectedPlugin?.id ??
      selectedCatalogEntry?.displayName ??
      listing?.entry.displayName ??
      null,
  );
  const pendingPluginId =
    pluginToggle.isPending && pluginToggle.variables
      ? pluginToggle.variables.id
      : removal.pendingPluginId;
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
  const handleOpenCatalogPlugin = useCallback(
    (nextPluginId: string) => {
      navigate({
        pathname: getPluginDetailRoutePath({ pluginId: nextPluginId }),
        search: location.search,
      });
    },
    [location.search, navigate],
  );

  let detailContent: ReactNode;
  if (listQuery.isError) {
    detailContent = (
      <ResourceListState
        state="error"
        message="Couldn't load plugin."
        layout="detail"
        maxWidthClassName="max-w-5xl"
        onRetry={() => void listQuery.refetch()}
      />
    );
  } else if (isLoading) {
    detailContent = (
      <ResourceListState
        state="loading"
        message="Loading plugin"
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  } else if (selectedPlugin !== null && configurationOpen) {
    detailContent = (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfigurationOpen(false)}
        >
          <Icon name="ChevronLeft" className="mr-1.5 size-4" aria-hidden />
          Back to details
        </Button>
        <PluginSettingsPage pluginId={pluginId} />
      </div>
    );
  } else if (selectedPlugin !== null) {
    detailContent = (
      <PluginDetail
        isLoading={false}
        plugin={selectedPlugin}
        pending={pendingPluginId === selectedPlugin.id}
        openSourceDisabled={!canOpenPreferredDirectoryTarget}
        onToggle={(target) => pluginToggle.mutate(target)}
        onEdit={handleEditPlugin}
        onOpenSource={handleOpenPluginSource}
        onDelete={removal.open}
        onConfigure={() => setConfigurationOpen(true)}
        headerActions={
          listing === null ? undefined : (
            <PluginListingActions record={listing} />
          )
        }
        catalogEntry={selectedCatalogEntry ?? undefined}
        catalogEntries={catalogQuery.data?.entries ?? []}
        onOpenPlugin={handleOpenCatalogPlugin}
      />
    );
  } else if (selectedCatalogEntry !== null && !selectedCatalogEntry.installed) {
    detailContent = (
      <CatalogPluginDetail
        entry={selectedCatalogEntry}
        headerActions={
          listing === null ? undefined : (
            <PluginListingActions record={listing} />
          )
        }
        onInstall={setInstallTarget}
        catalogEntries={catalogQuery.data?.entries ?? []}
        onOpenPlugin={handleOpenCatalogPlugin}
      />
    );
  } else if (listing !== null) {
    detailContent = <AuthoredPluginDetail record={listing} />;
  } else if (catalogQuery.isError) {
    detailContent = (
      <ResourceListState
        state="error"
        message="Couldn't load plugin."
        layout="detail"
        maxWidthClassName="max-w-5xl"
        onRetry={() => void catalogQuery.refetch()}
      />
    );
  } else if (catalogQuery.isFetching && catalogQuery.data === undefined) {
    detailContent = (
      <ResourceListState
        state="loading"
        message="Loading plugin"
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  } else if (selectedCatalogEntry?.installed) {
    detailContent = (
      <ResourceListState
        state="error"
        message="Couldn't load the installed plugin."
        layout="detail"
        maxWidthClassName="max-w-5xl"
        onRetry={() => void listQuery.refetch()}
      />
    );
  } else {
    detailContent = (
      <ResourceListState
        state="empty"
        message="Plugin not found."
        layout="detail"
        maxWidthClassName="max-w-5xl"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {selectedPlugin !== null ? (
        <PluginDetailBanners
          plugin={selectedPlugin}
          catalogEntry={selectedCatalogEntry ?? undefined}
          onConfigure={() => setConfigurationOpen(true)}
        />
      ) : selectedCatalogEntry !== null && !selectedCatalogEntry.installed ? (
        <CatalogPluginDetailBanner entry={selectedCatalogEntry} />
      ) : null}
      <div className="min-h-0 flex-1">
        <ResourceScrollPage>
          {detailContent}
          <PluginRemovalDialog removal={removal} />
          <AddPluginDialog
            open={installTarget !== null}
            initial={
              installTarget === null
                ? null
                : {
                    entryId: installTarget.entryId,
                    marketplace: installTarget.marketplace,
                    pluginId: installTarget.pluginId,
                    publisherLabel: installTarget.publisherLabel,
                    displayName: installTarget.displayName,
                    icon: installTarget.icon,
                    iconUrl: installTarget.iconUrl,
                    iconTinted: installTarget.iconTinted,
                    source: installTarget.source,
                  }
            }
            onOpenChange={(open) => {
              if (!open) setInstallTarget(null);
            }}
            onInstalled={() => void listQuery.refetch()}
          />
        </ResourceScrollPage>
      </div>
    </div>
  );
}

export function PluginDetailPaneView({ pluginId }: { pluginId: string }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<ResourceBodyFallback />}>
          <PluginDetailToolView pluginId={pluginId} />
        </Suspense>
      </div>
    </div>
  );
}

interface PluginsViewProps {
  pluginId?: string;
}

export function PluginsView({ pluginId }: PluginsViewProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const focusReturnRef = useRef<HTMLButtonElement | null>(null);
  const [isPluginDetailFullPage, setIsPluginDetailFullPage] = useState(false);
  const [workspace, setWorkspace] = useAtom(pluginWorkspaceAtom);
  const compactDetail = useMediaQuery("(max-width: 1023px)");
  const removal = usePluginRemoval();
  const activePluginId = pluginId ?? workspace.activePluginId;
  const isPanelOpen = activePluginId !== null;
  const catalogQuery = usePluginCatalogSearch("", { enabled: isPanelOpen });
  const listings = usePluginListings();
  const listQuery = usePluginList({ enabled: true });
  const openIds = useMemo(
    () =>
      pluginId !== undefined && !workspace.tabs.includes(pluginId)
        ? [...workspace.tabs, pluginId]
        : workspace.tabs,
    [pluginId, workspace.tabs],
  );

  useEffect(() => {
    if (pluginId === undefined) return;
    setWorkspace((current) =>
      current.activePluginId === pluginId && current.tabs.includes(pluginId)
        ? current
        : {
            tabs: current.tabs.includes(pluginId)
              ? current.tabs
              : [...current.tabs, pluginId],
            activePluginId: pluginId,
          },
    );
  }, [pluginId, setWorkspace]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("view") !== "my") return;
    params.set("view", "installed");
    navigate(
      { pathname: location.pathname, search: params.toString() },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  const selectPlugin = useCallback(
    (nextPluginId: string) => {
      const params = new URLSearchParams(location.search);
      params.delete("configure");
      navigate({
        pathname: getPluginDetailRoutePath({ pluginId: nextPluginId }),
        search: params.toString(),
      });
    },
    [location.search, navigate],
  );
  const openPlugin = useCallback(
    (nextPluginId: string, trigger: HTMLButtonElement) => {
      focusReturnRef.current = trigger;
      selectPlugin(nextPluginId);
    },
    [selectPlugin],
  );
  const restoreFocus = useCallback(() => {
    const target = focusReturnRef.current;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }, []);
  const closePanel = useCallback(() => {
    setIsPluginDetailFullPage(false);
    setWorkspace((current) => ({ ...current, activePluginId: null }));
    const params = new URLSearchParams(location.search);
    params.delete("configure");
    navigate({ pathname: getPluginsRoutePath(), search: params.toString() });
    restoreFocus();
  }, [location.search, navigate, restoreFocus, setWorkspace]);
  const closeTab = useCallback(
    (closedPluginId: string) => {
      const tabs = openIds.filter((id) => id !== closedPluginId);
      const closedIndex = openIds.indexOf(closedPluginId);
      const next =
        activePluginId === closedPluginId
          ? (tabs[Math.min(closedIndex, tabs.length - 1)] ?? null)
          : activePluginId;
      setWorkspace({ tabs, activePluginId: next });
      if (next !== null) selectPlugin(next);
      else closePanel();
    },
    [activePluginId, closePanel, openIds, selectPlugin, setWorkspace],
  );
  const reorderTab = useCallback<SecondaryPanelTabReorderHandler>(
    ({ activeTabId, overTabId }) => {
      const tabs = [...openIds];
      const from = tabs.findIndex(
        (id) => `marketplace-plugin:${id}` === activeTabId,
      );
      const to = tabs.findIndex(
        (id) => `marketplace-plugin:${id}` === overTabId,
      );
      if (from < 0 || to < 0 || from === to) return;
      const moving = tabs.splice(from, 1)[0];
      if (moving === undefined) return;
      tabs.splice(to, 0, moving);
      setWorkspace((current) => ({ ...current, tabs }));
    },
    [openIds, setWorkspace],
  );
  const panelTabs = useMemo<readonly SecondaryPanelRenderableTab[]>(
    () =>
      openIds.map((id) => {
        const entry = catalogQuery.data?.entries.find(
          (candidate) => candidate.pluginId === id,
        );
        const plugin = listQuery.data?.plugins.find(
          (candidate) => candidate.id === id,
        );
        return {
          contentFillsRegion: true,
          label:
            entry?.displayName ??
            plugin?.name ??
            listings.data?.records.find((record) => record.pluginId === id)
              ?.entry.displayName ??
            id,
          leadingVisual: (
            <PluginIcon
              pluginId={id}
              icon={entry?.icon ?? plugin?.icon ?? null}
              compactIconUrl={plugin?.compactIconUrl}
              className="size-3.5"
            />
          ),
          onClose: () => closeTab(id),
          onSelect: () => selectPlugin(id),
          renderContent: () => <PluginDetailToolView key={id} pluginId={id} />,
          statusLabel: null,
          tab: {
            id: `marketplace-plugin:${id}`,
            kind: "marketplace-plugin-detail",
          },
        };
      }),
    [
      catalogQuery.data?.entries,
      closeTab,
      listQuery.data?.plugins,
      listings.data?.records,
      openIds,
      selectPlugin,
    ],
  );
  const activeTab =
    panelTabs.find(
      (tab) => tab.tab.id === `marketplace-plugin:${activePluginId}`,
    )?.tab ?? null;
  const mainContent = (
    <div className="min-h-0 flex-1 overflow-hidden">
      <Suspense fallback={<ResourceBodyFallback />}>
        <PluginsToolView
          onOpenPlugin={openPlugin}
          onRemovePlugin={removal.open}
        />
      </Suspense>
      <PluginRemovalDialog removal={removal} />
    </div>
  );
  const renderPanel = useCallback(
    ({
      presentation,
      isMainCollapsed,
      onToggleMainCollapse,
      resizablePanelId,
    }: SecondaryPanelRenderArgs) => (
      <ThreadSecondaryPanel
        activeTab={activeTab}
        canUseGitUi={false}
        metadataContent={null}
        tabs={panelTabs}
        fixedTabs={[]}
        onTabReorder={reorderTab}
        isOpen={isPanelOpen}
        showConversationCollapseControl
        showNewTabButton={false}
        onPanelFocus={() => undefined}
        onCollapse={closePanel}
        onClose={closePanel}
        onOpenNewTab={() => undefined}
        isConversationCollapsed={isMainCollapsed}
        onToggleConversationCollapse={onToggleMainCollapse}
        renderAsDrawer={presentation === "drawer"}
        resizablePanelId={resizablePanelId}
      />
    ),
    [activeTab, closePanel, isPanelOpen, panelTabs, reorderTab],
  );

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <CompactViewportOverrideProvider isCompactViewport={compactDetail}>
        <SecondaryPanelLayout
          open={isPanelOpen}
          onToggle={isPanelOpen ? closePanel : () => undefined}
          onClose={closePanel}
          panelGroupKey="extensions-plugin-details"
          resetKey="extensions-plugin-details"
          contentKey={activePluginId ?? "extensions-plugins"}
          drawerLabel="Plugin details"
          drawerFallback={<ResourceBodyFallback />}
          mainPanelId="extensions-main-panel"
          main={mainContent}
          collapse={{
            active: isPluginDetailFullPage,
            onToggle: () => setIsPluginDetailFullPage((current) => !current),
          }}
          renderPanel={renderPanel}
          composerHost={null}
          compactPresentation="full"
        />
      </CompactViewportOverrideProvider>
    </div>
  );
}

export function SkillsView() {
  const location = useLocation();
  const isCollection =
    matchPath(SKILLS_ROUTE_PATH, location.pathname) !== null ||
    location.pathname === REGISTRY_SKILLS_ROUTE_PATH;

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<ResourceBodyFallback />}>
          <ResourceScrollPage fillViewport={isCollection}>
            <SkillsLibrary />
          </ResourceScrollPage>
        </Suspense>
      </div>
    </div>
  );
}
