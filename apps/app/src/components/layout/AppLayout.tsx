import { useCorePageTitle } from "./core-page-title";
import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { atom, useAtom, useAtomValue, useStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  Link,
  matchPath,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { ProjectResponse } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { useRedirectRetiredPluginPaths } from "@/lib/retired-plugin-redirect";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useIsSidebarFramed,
  useSidebar,
} from "@/components/ui/sidebar.js";
import {
  resolveThreadTitleDisplayText,
  ThreadTitleMentionResourcesProvider,
  useSidebarThreadTitleMentionResources,
} from "@/components/thread/ThreadTitleMentions";
import { CommandPalette } from "@/components/commands/CommandPalette";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import {
  resolvePluginsWorkspaceHeaderMeta,
  resolveSkillsWorkspaceHeaderMeta,
  resolveToolsSection,
  type ToolsSectionId,
} from "@/components/tools/tools-navigation";
import { AppBreadcrumbs } from "./AppBreadcrumbs";
import { PageTitleHeader } from "./PageTitleHeader";
import {
  PageTitleHookHost,
  usePageTitleValue,
  focusedPageTitleAtom,
} from "./page-title";
import { AppPageHeader, HEADER_ICON_BUTTON_CLASS } from "./AppPageHeader";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { SidebarThreadEntriesProvider } from "@/lib/sidebar-thread-entries";
import {
  didThreadDetailBootstrapRefreshAfterMount,
  useThread,
  useThreadDetailBootstrap,
  useThreadPendingInteractions,
} from "@/hooks/queries/thread-queries";
import { useRouteState } from "@/hooks/useRouteState";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { cn } from "@bb/shared-ui/lib/utils";
import { APP_OVERLAY_LAYER } from "@/components/ui/app-overlay-layers";
import {
  COMPACT_SHELF_HIDDEN_FIXED_CHROME_CLASS,
  usePanelShelfState,
} from "@/components/ui/secondary-panel-shelf-visibility";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import { ProjectActionsMenu } from "@/components/project/ProjectActionsMenu";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "@/components/plugin/PluginPanelHeader";
import { PluginAppOverlays } from "@/components/plugin/PluginAppOverlays";
import { ThreadRowMetadataCollectors } from "@/components/plugin/ThreadRowMetadataCollectors";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import {
  usePluginNavPanelChrome,
  type PluginNavPanelChrome,
} from "@/lib/plugin-nav-panel-chrome";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { createTabScopedStorage } from "@/lib/browser-storage";
import {
  BROWSER_SIDEBAR_TRIGGER_INSET_CLASS,
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_TITLE_BAR_CONTROL_AXIS_CLASS,
  MACOS_TITLE_BAR_CONTROL_SIZE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { useDataDirectoryCommand } from "@/hooks/useDataDirectoryCommand";
import { useWindowReloadCommand } from "@/hooks/useWindowReloadCommand";
import { usePluginSafeModeCommands } from "@/hooks/usePluginSafeModeCommands";
import { usePluginCachePruneCommand } from "@/hooks/usePluginCachePruneCommand";
import { useServerDaemonLogsCommand } from "@/hooks/useServerDaemonLogsCommand";
import {
  getLegacyProjectComposeRoutePath,
  getSettingsProjectRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
  isProjectlessProjectId,
  SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { IframeDragGuardOverlay } from "@/lib/iframe-drag-guard";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import { useFaviconBadge } from "@/lib/favicon-color-preference";
import { shouldShowFaviconAttentionDot } from "./faviconAttentionDot";
import { AppLayoutSidebar } from "./AppLayoutSidebar";
import { resolveRouteSidebar } from "./routeSidebar";
import { NAV_RAIL_COLLAPSED_SIDEBAR_WIDTH } from "@/components/sidebar/navRailWidth";
import { useSidebarNavigationPlacement } from "@/components/sidebar/sidebarNavigationProvider";
import { SidebarHistoryNavigationControls } from "@/components/sidebar/SidebarHistoryNavigationControls";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useMobileVisualViewportHeight } from "./useMobileVisualViewportHeight";
import { isIOSWebKit } from "@/lib/ios-webkit";
import { wsManager } from "@/lib/ws";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { findPaneByThread } from "@/lib/split-layout";
import {
  applyThreadOpenToLayout,
  paneContentForPathname,
} from "@/views/thread-detail/splitThreadNavigation";
import { useAppSettingsRouteMemory } from "@/hooks/useAppSettingsRouteMemory";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { BackToAppCommandHandler } from "./BackToAppCommandHandler";
import { HistoryCommandHandlers } from "./HistoryCommandHandlers";

const SIDEBAR_WIDTH_KEY = "bb.sidebar.width";
const SIDEBAR_OPEN_KEY = "bb.sidebar.open";
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 460;
const SIDEBAR_DEFAULT_WIDTH = 320;

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

const sidebarWidthStorage = createTabScopedStorage<number>(
  {
    parse: (storedValue, initialValue) => {
      if (storedValue === null) {
        return initialValue;
      }
      const parsedValue = Number(storedValue);
      if (!Number.isFinite(parsedValue)) {
        return initialValue;
      }
      return clampSidebarWidth(parsedValue);
    },
    serialize: (value) => String(clampSidebarWidth(value)),
  },
  { persistInitialValue: true },
);

const sidebarWidthAtom = atomWithStorage<number>(
  SIDEBAR_WIDTH_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  sidebarWidthStorage,
  { getOnInit: true },
);
const sidebarLiveWidthAtom = atom<number | null>(null);

const sidebarOpenStorage = createTabScopedStorage<boolean>(
  {
    parse: (storedValue, initialValue) => {
      if (storedValue === "true") return true;
      if (storedValue === "false") return false;
      return initialValue;
    },
    serialize: (value) => String(value),
  },
  { persistInitialValue: true },
);

const sidebarOpenAtom = atomWithStorage<boolean>(
  SIDEBAR_OPEN_KEY,
  true,
  sidebarOpenStorage,
  { getOnInit: true },
);

interface SidebarStateBridgeProps {
  usesDesktopChrome: boolean;
  children: ReactNode;
}

type SidebarResizeMouseEvent = ReactMouseEvent<HTMLDivElement>;
type SidebarOpenChangeHandler = (open: boolean) => void;

function SidebarStateBridge({
  usesDesktopChrome,
  children,
}: SidebarStateBridgeProps) {
  const [open, setOpen] = useAtom(sidebarOpenAtom);
  const hasRail = useSidebarNavigationPlacement() === "rail";
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const sidebarLiveWidth = useAtomValue(sidebarLiveWidthAtom);
  const handleOpenChange = useCallback<SidebarOpenChangeHandler>(
    (nextOpen) => {
      setOpen(nextOpen);
      window.requestAnimationFrame(dispatchBrowserViewBoundsSync);
    },
    [setOpen],
  );
  useAppCommandHandler("sidebar.toggle", () => {
    handleOpenChange(!open);
    return true;
  });
  return (
    <SidebarProvider
      width={`${sidebarLiveWidth ?? sidebarWidth}px`}
      collapsedRailWidth={
        hasRail ? NAV_RAIL_COLLAPSED_SIDEBAR_WIDTH : undefined
      }
      framed={usesDesktopChrome}
      data-testid="app-layout-root"
      open={open}
      onOpenChange={handleOpenChange}
    >
      {children}
    </SidebarProvider>
  );
}

function resetSidebarResizeDocumentState(): void {
  document.body.classList.remove("sidebar-resizing");
}

const MACOS_SIDEBAR_TRIGGER_TRANSITION_CLASS =
  "[transition:left_120ms_linear,padding-left_120ms_linear]";

interface SidebarTriggerOverlayProps {
  reserveMacosTrafficLights: boolean;
  usesDesktopChrome: boolean;
}

function SidebarTriggerOverlay({
  reserveMacosTrafficLights,
  usesDesktopChrome,
}: SidebarTriggerOverlayProps) {
  const isCompactViewport = useIsCompactViewport();
  const { openMobile } = useSidebar();
  const isFramed = useIsSidebarFramed();
  const panelShelfState = usePanelShelfState({
    isCompactViewport,
    isSidebarDrawerOpen: openMobile,
  });
  const shortcut = useAppCommandShortcut("sidebar.toggle");
  const triggerProps = {
    "aria-label": shortcut
      ? `Toggle sidebar (${shortcut.label})`
      : "Toggle sidebar",
    "aria-keyshortcuts": shortcut?.ariaKeyshortcuts,
  };
  if (isFramed) {
    return (
      <div
        data-testid="app-window-title-bar"
        style={{ zIndex: APP_OVERLAY_LAYER.sidebarTrigger }}
        className={cn(
          "pointer-events-none fixed top-0 left-0",
          "flex h-(--bb-window-title-bar-height) items-center",
          MACOS_TITLE_BAR_CONTROL_AXIS_CLASS,
          MACOS_TITLE_BAR_CONTROL_SIZE_CLASS,
          reserveMacosTrafficLights
            ? MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS
            : BROWSER_SIDEBAR_TRIGGER_INSET_CLASS,
        )}
      >
        <div
          className={cn(
            "pointer-events-auto flex items-center gap-(--bb-title-bar-sidebar-toggle-gap)",
            MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
          )}
        >
          <SidebarHistoryNavigationControls className="gap-0" />
          <SidebarTrigger {...triggerProps} />
        </div>
      </div>
    );
  }
  if (usesDesktopChrome) {
    return (
      <div
        data-testid="app-desktop-sidebar-trigger"
        data-panel-shelf={panelShelfState}
        style={{ zIndex: APP_OVERLAY_LAYER.sidebarTrigger }}
        className={cn(
          "fixed top-0 motion-reduce:transition-none!",
          COMPACT_SHELF_HIDDEN_FIXED_CHROME_CLASS,
          CHROME_ROW_CLASS,
          MACOS_SIDEBAR_TRIGGER_TRANSITION_CLASS,
          reserveMacosTrafficLights
            ? MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS
            : ["left-0", BROWSER_SIDEBAR_TRIGGER_INSET_CLASS],
          MACOS_WINDOW_DRAG_CLASS,
          MACOS_TITLE_BAR_CONTROL_SIZE_CLASS,
        )}
      >
        <SidebarTrigger
          className={MACOS_CHROME_CONTROL_NO_DRAG_CLASS}
          {...triggerProps}
        />
      </div>
    );
  }
  return (
    <div
      data-testid="app-sidebar-trigger-overlay"
      data-panel-shelf={panelShelfState}
      style={{
        zIndex: isCompactViewport
          ? APP_OVERLAY_LAYER.compactSidebarTrigger
          : APP_OVERLAY_LAYER.sidebarTrigger,
      }}
      className={cn(
        "fixed top-[env(safe-area-inset-top)] left-[env(safe-area-inset-left)]",
        COMPACT_SHELF_HIDDEN_FIXED_CHROME_CLASS,
        CHROME_ROW_CLASS,
        BROWSER_SIDEBAR_TRIGGER_INSET_CLASS,
      )}
    >
      <SidebarTrigger {...triggerProps} />
    </div>
  );
}

const routeTitles: Record<string, { title: string }> = {
  "/": { title: "bb" },
  "/settings": { title: "Settings" },
  "/automations": { title: "Automations" },
  "/skills": { title: "Skills" },
};

function resolveRouteTitle(pathname: string): { title: string } | undefined {
  if (matchPath(`${SETTINGS_ROUTE_PATH}/*`, pathname)) {
    return routeTitles[SETTINGS_ROUTE_PATH];
  }
  return routeTitles[pathname];
}

interface AppHeaderProps {
  resourceSection: ToolsSectionId | null;
  usesProjectChromeStyle: boolean;
  usesDesktopChrome: boolean;
  projectId?: string;
  project?: ProjectResponse;
  pluginPanel?: PluginNavPanelSlot;
  pluginPanelChrome?: PluginNavPanelChrome;
  pluginPanelSubPath?: string;
  meta: {
    title: string;
    breadcrumbs?: Array<{ label: string; to?: string }>;
  };
}

function AppHeader({
  resourceSection,
  usesProjectChromeStyle,
  usesDesktopChrome,
  projectId,
  project,
  pluginPanel,
  pluginPanelChrome,
  pluginPanelSubPath,
  meta,
}: AppHeaderProps) {
  const pageTitle = usePageTitleValue();
  const headerBreadcrumbs = pluginPanelChrome
    ? undefined
    : (pageTitle?.breadcrumbs ?? meta.breadcrumbs);
  const headerTitle =
    headerBreadcrumbs || usesProjectChromeStyle
      ? undefined
      : (pageTitle?.title ?? meta.title);

  const hasCenterContent = Boolean(headerBreadcrumbs) || Boolean(headerTitle);

  const center = resourceSection ? (
    <PageTitleHeader
      icon={
        <Icon
          name={resourceSection === "plugins" ? "Plug02" : "Zap"}
          className="size-4 shrink-0 text-muted-foreground"
        />
      }
      title={resourceSection === "plugins" ? "Plugins" : "Skills"}
      value={pageTitle}
    />
  ) : headerBreadcrumbs ? (
    <div className="min-w-0 flex-1">
      <AppBreadcrumbs
        breadcrumbs={headerBreadcrumbs}
        usesDesktopChrome={usesDesktopChrome}
      />
    </div>
  ) : pluginPanelChrome ? (
    <PluginPanelHeaderCenter chrome={pluginPanelChrome} />
  ) : hasCenterContent ? (
    <div className="min-w-0 flex-1">
      {headerTitle ? (
        <p className="truncate text-sm font-semibold">{headerTitle}</p>
      ) : null}
    </div>
  ) : null;

  const actions = pluginPanel ? (
    <PluginPanelHeaderActions
      panel={pluginPanel}
      subPath={pluginPanelSubPath ?? ""}
    />
  ) : usesProjectChromeStyle &&
    projectId &&
    !isProjectlessProjectId(projectId) ? (
    <>
      <Link
        to={getSettingsProjectRoutePath(projectId)}
        className={cn(
          HEADER_ICON_BUTTON_CLASS,
          "inline-flex items-center justify-center transition-colors",
          "text-muted-foreground hover:bg-state-hover hover:text-foreground",
        )}
        aria-label="Project settings"
      >
        <Icon name="Settings" />
      </Link>
      {project ? (
        <ProjectActionsMenu
          project={project}
          triggerClassName={HEADER_ICON_BUTTON_CLASS}
        />
      ) : null}
    </>
  ) : null;

  return <AppPageHeader center={center} actions={actions} />;
}

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  return (
    <PageTitleHookHost
      usePageTitle={useCorePageTitle}
      subPath={location.pathname + location.search}
    >
      <AppLayoutContent>{children}</AppLayoutContent>
    </PageTitleHookHost>
  );
}

function AppLayoutContent({ children }: AppLayoutProps) {
  const quickCreateProject = useQuickCreateProjectController();
  const isCompactViewport = useIsCompactViewport();
  const store = useStore();
  const [contentShell, setContentShell] = useState<HTMLDivElement | null>(null);
  const restoreIOSViewportOnKeyboardDismissal = useMemo(
    () => isIOSWebKit(navigator),
    [],
  );
  useMobileVisualViewportHeight(
    contentShell,
    isCompactViewport,
    restoreIOSViewportOnKeyboardDismissal,
  );
  const location = useLocation();
  useRedirectRetiredPluginPaths();
  const { projectId, threadId, isThreadView, isArchivedView, isRootView } =
    useRouteState();
  const focusedPageTitle = useAtomValue(focusedPageTitleAtom);
  const navigate = useNavigate();
  const navPanelChrome = usePluginNavPanelChrome();
  const isGlobalSettingsView =
    matchPath(`${SETTINGS_ROUTE_PATH}/*`, location.pathname) !== null;
  const routeContent = paneContentForPathname(location.pathname);
  const pluginPanelRoute =
    routeContent?.kind === "plugin-panel" ? routeContent : null;
  const pluginPanelEntry = pluginPanelRoute
    ? navPanelChrome.find(
        (candidate) =>
          candidate.chrome.pluginId === pluginPanelRoute.pluginId &&
          candidate.chrome.path === pluginPanelRoute.panelPath,
      )
    : undefined;
  const pluginPanel = pluginPanelEntry?.panel ?? undefined;
  const pluginPanelChrome = pluginPanelEntry?.chrome;
  const pluginPanelSubPath = pluginPanelRoute?.subPath ?? "";
  const routeSidebar = resolveRouteSidebar(
    location.pathname,
    pluginPanel === undefined
      ? null
      : { panel: pluginPanel, subPath: pluginPanelSubPath },
  );
  const { appRoutePath, settingsRoutePath, sectionBackRoutePath } =
    useAppSettingsRouteMemory(routeSidebar !== null);
  const backToAppRoutePath =
    routeSidebar === null
      ? null
      : isGlobalSettingsView
        ? appRoutePath
        : sectionBackRoutePath;
  const setRootComposeProjectId = useSetRootComposeProjectId();
  useEffect(
    () =>
      wsManager.onThreadOpen((signal) => {
        const route = getThreadRoutePath({
          projectId: signal.projectId,
          threadId: signal.threadId,
        });
        const current = store.get(splitLayoutAtom);
        const alreadyOpen =
          current !== null &&
          findPaneByThread(current.root, signal.projectId, signal.threadId) !==
            null;
        const next = applyThreadOpenToLayout(
          current,
          { projectId: signal.projectId, threadId: signal.threadId },
          isCompactViewport ? "replace" : signal.split,
        );
        if (next !== current) {
          store.set(splitLayoutAtom, next);
        }
        void navigate(route, alreadyOpen ? { replace: true } : undefined);
      }),
    [isCompactViewport, navigate, store],
  );
  useAppCommandHandler("thread.new", () => {
    if (projectId !== undefined) {
      setRootComposeProjectId(projectId);
    }
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
    return true;
  });
  useAppCommandHandler("settings.open", () => {
    void navigate(settingsRoutePath);
    return true;
  });
  useAppCommandHandler("settings.openServers", () => {
    void navigate(`${SETTINGS_ROUTE_PATH}/servers`);
    return true;
  });
  useServerDaemonLogsCommand();
  useDataDirectoryCommand();
  useWindowReloadCommand();
  usePluginSafeModeCommands();
  usePluginCachePruneCommand();
  const archivedSectionId = isArchivedView
    ? new URLSearchParams(location.search).get("sectionId")
    : null;
  const sidebarNavigationQuery = useSidebarNavigation();
  const projects = useMemo(
    () => sidebarNavigationQuery.data?.projects.map(stripProjectThreads),
    [sidebarNavigationQuery.data],
  );
  const sidebarThreads = useMemo(() => {
    const sidebarNavigation = sidebarNavigationQuery.data;
    if (!sidebarNavigation) {
      return [];
    }
    return [
      ...sidebarNavigation.projects.flatMap((project) => project.threads),
      ...sidebarNavigation.personalProject.threads,
    ];
  }, [sidebarNavigationQuery.data]);
  const titleMentionResources = useSidebarThreadTitleMentionResources(
    sidebarNavigationQuery.data,
  );
  const threadDetailBootstrapQuery = useThreadDetailBootstrap(threadId ?? "", {
    enabled: isThreadView && Boolean(threadId),
    timelinePrefetch: isThreadView && Boolean(threadId),
  });
  const hasThreadDetailBootstrapSettled =
    threadDetailBootstrapQuery.isSuccess || threadDetailBootstrapQuery.isError;
  const resolvedThreadProjectId = threadDetailBootstrapQuery.data?.projectId;
  const canonicalThreadRoutePath =
    isThreadView &&
    projectId !== undefined &&
    threadId !== undefined &&
    resolvedThreadProjectId !== undefined &&
    resolvedThreadProjectId !== projectId
      ? getThreadRoutePath({
          projectId: resolvedThreadProjectId,
          threadId,
        })
      : null;
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const liveWidthRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const showHeader = !isThreadView && !isRootView && pluginPanelRoute === null;
  const [desktopInfo] = useState(getBbDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const reserveMacosTrafficLights = shouldReserveMacosTrafficLights({
    desktopInfo,
    windowState: desktopWindowState,
  });
  const project = projectId
    ? projects?.find((candidate) => candidate.id === projectId)
    : undefined;
  const archivedSectionName = archivedSectionId
    ? (sidebarNavigationQuery.data?.sections.find(
        (section) => section.id === archivedSectionId,
      )?.name ?? archivedSectionId)
    : null;
  const projectName = projectId ? project?.name : undefined;
  const projectLabel = projectName ?? (projectId ? projectId : undefined);
  const { data: thread } = useThread(threadId ?? "", {
    enabled:
      Boolean(threadId) && (!isThreadView || hasThreadDetailBootstrapSettled),
    refetchOnMount:
      isThreadView &&
      didThreadDetailBootstrapRefreshAfterMount(threadDetailBootstrapQuery)
        ? false
        : "always",
  });
  const threadDisplayTitle = thread
    ? resolveThreadTitleDisplayText(
        getThreadDisplayTitle(thread),
        titleMentionResources,
      )
    : threadId
      ? `Thread ${threadId.slice(0, 8)}`
      : "Thread";
  const resourceWorkspaceHeaderMeta =
    resolvePluginsWorkspaceHeaderMeta(location.pathname, location.search) ??
    resolveSkillsWorkspaceHeaderMeta(location.pathname);
  const meta =
    resourceWorkspaceHeaderMeta?.kind === "section-title"
      ? { title: resourceWorkspaceHeaderMeta.title }
      : resourceWorkspaceHeaderMeta?.kind === "breadcrumbs"
        ? {
            title: "",
            breadcrumbs: resourceWorkspaceHeaderMeta.breadcrumbs,
          }
        : isArchivedView && projectId
          ? isProjectlessProjectId(projectId)
            ? {
                title: "",
                breadcrumbs: [
                  { label: "Threads", to: getRootComposeRoutePath() },
                  ...(archivedSectionName
                    ? [{ label: archivedSectionName }]
                    : []),
                  { label: "Archived" },
                ],
              }
            : {
                title: "",
                breadcrumbs: [
                  {
                    label: projectLabel ?? projectId,
                    to: getLegacyProjectComposeRoutePath(projectId),
                  },
                  { label: "Archived" },
                ],
              }
          : projectId
            ? {
                title: projectLabel ?? projectId,
              }
            : (resolveRouteTitle(location.pathname) ?? { title: "" });

  const documentTitle = (() => {
    if (focusedPageTitle) {
      if (focusedPageTitle.windowTitle !== undefined)
        return focusedPageTitle.windowTitle;
      const leaf =
        focusedPageTitle.title ?? focusedPageTitle.breadcrumbs?.at(-1)?.label;
      const base =
        pluginPanel?.title ?? focusedPageTitle.breadcrumbs?.[0]?.label;
      if (leaf) return base && base !== leaf ? `${leaf} · ${base}` : leaf;
    }
    if (isThreadView) {
      return threadDisplayTitle;
    }
    if (pluginPanel) {
      return pluginPanel.title;
    }
    if (isArchivedView && projectId) {
      if (isProjectlessProjectId(projectId)) {
        return archivedSectionName
          ? `${archivedSectionName} · Archived`
          : "Threads · Archived";
      }
      return `${projectLabel ?? projectId} · Archived`;
    }
    if (projectId) {
      return projectLabel ?? projectId;
    }
    const routeTitle = resolveRouteTitle(location.pathname)?.title;
    return routeTitle && routeTitle.length > 0 ? routeTitle : "BB";
  })();
  const currentThreadPendingInteractionsQuery = useThreadPendingInteractions(
    threadId ?? "",
    { enabled: isThreadView && Boolean(threadId) },
  );
  const currentThreadHasPendingInteraction =
    (currentThreadPendingInteractionsQuery.data?.length ?? 0) > 0;
  const faviconBadge = shouldShowFaviconAttentionDot({
    currentThreadHasPendingInteraction,
    currentThreadId: threadId,
    isThreadView,
    sidebarThreads,
    thread,
  })
    ? "unread"
    : "none";
  useFaviconBadge(faviconBadge);

  const handleResizeMouseDown = useCallback(
    (event: SidebarResizeMouseEvent) => {
      event.preventDefault();
      setIsSidebarResizing(true);
      startXRef.current = event.clientX;
      startWidthRef.current = store.get(sidebarWidthAtom);
      liveWidthRef.current = startWidthRef.current;
      document.body.classList.add("sidebar-resizing");
    },
    [store],
  );

  const finishSidebarResize = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    flushSync(() => {
      store.set(sidebarWidthAtom, liveWidthRef.current);
      store.set(sidebarLiveWidthAtom, null);
    });
    dispatchBrowserViewBoundsSync();
    setIsSidebarResizing(false);
    resetSidebarResizeDocumentState();
  }, [store]);

  useEffect(() => {
    if (!isSidebarResizing) return;

    const applyLiveWidth = () => {
      animationFrameRef.current = null;
      flushSync(() => {
        store.set(sidebarLiveWidthAtom, liveWidthRef.current);
      });
      dispatchBrowserViewBoundsSync();
    };

    const handleMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startXRef.current;
      liveWidthRef.current = clampSidebarWidth(startWidthRef.current + delta);
      if (animationFrameRef.current === null) {
        animationFrameRef.current =
          window.requestAnimationFrame(applyLiveWidth);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        finishSidebarResize();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finishSidebarResize);
    window.addEventListener("blur", finishSidebarResize);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finishSidebarResize);
      window.removeEventListener("blur", finishSidebarResize);
      window.removeEventListener("keydown", handleKeyDown);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      store.set(sidebarLiveWidthAtom, null);
      resetSidebarResizeDocumentState();
    };
  }, [finishSidebarResize, isSidebarResizing, store]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = documentTitle;
  }, [documentTitle]);

  if (canonicalThreadRoutePath !== null) {
    return (
      <Navigate
        to={{
          pathname: canonicalThreadRoutePath,
          search: location.search,
          hash: location.hash,
        }}
        replace
      />
    );
  }

  return (
    <SidebarThreadEntriesProvider navigation={sidebarNavigationQuery.data}>
      <TooltipProvider delayDuration={300} disableHoverableContent>
        <ProjectActionsProvider>
          <ThreadTitleMentionResourcesProvider {...titleMentionResources}>
            <ThreadActionsProvider>
              <SidebarStateBridge usesDesktopChrome={usesDesktopChrome}>
                {backToAppRoutePath !== null && !isSidebarResizing ? (
                  <BackToAppCommandHandler routePath={backToAppRoutePath} />
                ) : null}
                <HistoryCommandHandlers />
                <AppLayoutSidebar
                  routeSidebar={routeSidebar}
                  isSettingsActive={isGlobalSettingsView}
                  onResizeMouseDown={handleResizeMouseDown}
                  isResizing={isSidebarResizing}
                  settingsRoutePath={settingsRoutePath}
                  backToAppRoutePath={backToAppRoutePath}
                />
                <SidebarInset>
                  <div
                    ref={setContentShell}
                    data-testid="app-layout-content-shell"
                    data-app-content-shell=""
                    className="relative flex h-full min-h-0 min-w-0 w-full flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[var(--bb-safe-area-bottom,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)]"
                  >
                    {showHeader ? (
                      <AppHeader
                        resourceSection={
                          resourceWorkspaceHeaderMeta
                            ? resolveToolsSection(location.pathname)
                            : null
                        }
                        usesDesktopChrome={usesDesktopChrome}
                        usesProjectChromeStyle={isRootView || isArchivedView}
                        projectId={projectId}
                        project={project}
                        pluginPanel={pluginPanel}
                        pluginPanelChrome={pluginPanelChrome}
                        pluginPanelSubPath={pluginPanelSubPath}
                        meta={meta}
                      />
                    ) : null}
                    <main className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
                      {children}
                    </main>
                  </div>
                </SidebarInset>
                <SidebarTriggerOverlay
                  reserveMacosTrafficLights={reserveMacosTrafficLights}
                  usesDesktopChrome={usesDesktopChrome}
                />
              </SidebarStateBridge>
              <PluginAppOverlays />
              <ThreadRowMetadataCollectors />
              <IframeDragGuardOverlay
                active={isSidebarResizing}
                cursor="col-resize"
              />
              <CommandPalette
                threadId={threadId ?? null}
                projectId={projectId ?? null}
              />
              <NotificationCenter />
              <ProjectPathDialog
                target={quickCreateProject.projectPathDialog.target}
                pending={quickCreateProject.isCreating}
                platform={quickCreateProject.platform}
                hostId={quickCreateProject.hostId}
                hostName={quickCreateProject.hostName}
                hosts={quickCreateProject.hosts}
                onOpenChange={quickCreateProject.projectPathDialog.onOpenChange}
                onSubmit={quickCreateProject.submitProjectPath}
              />
            </ThreadActionsProvider>
          </ThreadTitleMentionResourcesProvider>
        </ProjectActionsProvider>
      </TooltipProvider>
    </SidebarThreadEntriesProvider>
  );
}
