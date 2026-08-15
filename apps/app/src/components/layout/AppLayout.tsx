import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type ReactNode,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import type { ProjectResponse } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { RESOURCE_ROUTE_LABEL_EVENT } from "@bb/shared-ui/resource-list";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar.js";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import {
  resolveAutomationBreadcrumbs,
  resolveToolsAreaHeaderMeta,
  resolveToolsBreadcrumbs,
} from "@/components/tools/tools-navigation";
import { AppBreadcrumbs } from "./AppBreadcrumbs";
import { resourceRouteLabelAtom } from "./resourceRouteLabelAtom";
import { AppPageHeader, HEADER_ICON_BUTTON_CLASS } from "./AppPageHeader";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  didThreadDetailBootstrapRefreshAfterMount,
  getLatestPendingInteraction,
  useThread,
  useThreadDetailBootstrap,
  useThreadPendingInteractions,
} from "@/hooks/queries/thread-queries";
import { useRouteState } from "@/hooks/useRouteState";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { applyResizeCursor, clearResizeCursor } from "@/lib/resizeCursor";
import { cn } from "@bb/shared-ui/lib/utils";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import { ProjectActionsMenu } from "@/components/project/ProjectActionsMenu";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "@/components/plugin/PluginPanelHeader";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { usePluginSlots, type PluginNavPanelSlot } from "@/lib/plugin-slots";
import { createLocalStorageSyncStorage } from "@/lib/browser-storage";
import {
  BROWSER_SIDEBAR_TRIGGER_INSET_CLASS,
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import {
  getLegacyProjectComposeRoutePath,
  getProjectSettingsRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
  isProjectlessProjectId,
  isToolsRoutePath,
  PLUGIN_PANEL_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { IframeDragGuardOverlay } from "@/lib/iframe-drag-guard";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import { useFaviconBadge } from "@/lib/favicon-color-preference";
import { shouldShowFaviconAttentionDot } from "./faviconAttentionDot";
import { AppLayoutSidebar } from "./AppLayoutSidebar";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  shouldRestoreIOSViewportOnKeyboardDismissal,
  useMobileVisualViewportHeight,
} from "./useMobileVisualViewportHeight";
import { wsManager } from "@/lib/ws";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { findPaneByThread } from "@/lib/split-layout";
import { applyThreadOpenToLayout } from "@/views/thread-detail/splitThreadNavigation";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { useSplitWorkspaceActive } from "@/hooks/useSplitWorkspaceActive";
import { useAppSettingsRouteMemory } from "@/hooks/useAppSettingsRouteMemory";

const SIDEBAR_WIDTH_KEY = "bb.sidebar.width";
const SIDEBAR_OPEN_KEY = "bb.sidebar.open";
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 460;
const SIDEBAR_DEFAULT_WIDTH = 320;

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

const sidebarWidthStorage = createLocalStorageSyncStorage<number>({
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
});
const sidebarWidthAtom = atomWithStorage<number>(
  SIDEBAR_WIDTH_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  sidebarWidthStorage,
  { getOnInit: true },
);

// Held in jotai (rather than as `useState` inside AppLayout) so that toggling
// the sidebar does not re-render AppLayout — only the small bridge below
// subscribes. AppLayout's `children` reference stays stable across toggles,
// so React's element-reference bailout skips re-rendering the entire route
// subtree (ThreadDetailView, the timeline, etc.).
const sidebarOpenStorage = createLocalStorageSyncStorage<boolean>({
  parse: (storedValue, initialValue) => {
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;
    return initialValue;
  },
  serialize: (value) => String(value),
});
const sidebarOpenAtom = atomWithStorage<boolean>(
  SIDEBAR_OPEN_KEY,
  true,
  sidebarOpenStorage,
  { getOnInit: true },
);

interface SidebarStateBridgeProps {
  className?: string;
  providerRef: Ref<HTMLDivElement>;
  style: CSSProperties;
  children: ReactNode;
}

type SidebarResizeMouseEvent = ReactMouseEvent<HTMLDivElement>;
type SidebarOpenChangeHandler = (open: boolean) => void;

type SidebarProviderStyle = CSSProperties & {
  "--sidebar-width": string;
};

function SidebarStateBridge({
  className,
  providerRef,
  style,
  children,
}: SidebarStateBridgeProps) {
  const [open, setOpen] = useAtom(sidebarOpenAtom);
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
      ref={providerRef}
      style={style}
      className={className}
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
  clearResizeCursor();
  document.body.style.userSelect = "";
}

interface SidebarTriggerOverlayProps {
  reserveMacosTrafficLights: boolean;
  usesDesktopChrome: boolean;
}

/**
 * Sidebar toggle pinned at the app's top-left, rendered once at the layout root
 * — outside the sliding sidebar panel and the content inset — so it holds a
 * constant position while the sidebar animates in/out behind it, instead of
 * riding whichever container would otherwise host it. The collapsed page header
 * reserves its footprint as animated padding (see AppPageHeader), so toggling
 * slides the header content smoothly past it rather than snapping around a
 * toggle that mounts/unmounts in the header.
 *
 * Desktop chrome keeps the strip a window-drag region; only the button itself
 * is no-drag, so the title strip above and below the (shorter) button stays
 * draggable rather than becoming an oversized dead zone. When macOS traffic
 * lights are visible it offsets past them; in fullscreen, where the lights are
 * hidden, it uses the same small top-left inset as browser chrome.
 */
function SidebarTriggerOverlay({
  reserveMacosTrafficLights,
  usesDesktopChrome,
}: SidebarTriggerOverlayProps) {
  const shortcut = useAppCommandShortcut("sidebar.toggle");
  const triggerProps = {
    "aria-label": shortcut
      ? `Toggle sidebar (${shortcut.label})`
      : "Toggle sidebar",
    "aria-keyshortcuts": shortcut?.ariaKeyshortcuts,
  };
  if (usesDesktopChrome) {
    return (
      <div
        data-testid="app-desktop-sidebar-trigger"
        className={cn(
          "fixed top-0 z-50",
          CHROME_ROW_CLASS,
          reserveMacosTrafficLights
            ? MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS
            : "left-0",
          !reserveMacosTrafficLights && BROWSER_SIDEBAR_TRIGGER_INSET_CLASS,
          MACOS_WINDOW_DRAG_CLASS,
        )}
      >
        {/* The overlay's CHROME_ROW_CLASS box-centers the trigger on the shared
            traffic-light axis, matching the sidebar arrows and page-title
            header in desktop chrome. */}
        <SidebarTrigger
          className={MACOS_CHROME_CONTROL_NO_DRAG_CLASS}
          {...triggerProps}
        />
        <AppCommandShortcutHint
          shortcut={shortcut}
          className={cn(
            "absolute left-full ml-1",
            MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS,
          )}
        />
      </div>
    );
  }
  return (
    <div
      data-testid="app-sidebar-trigger-overlay"
      className={cn(
        "fixed top-[env(safe-area-inset-top)] left-[env(safe-area-inset-left)] z-50",
        CHROME_ROW_CLASS,
        BROWSER_SIDEBAR_TRIGGER_INSET_CLASS,
      )}
    >
      <SidebarTrigger {...triggerProps} />
      <AppCommandShortcutHint
        shortcut={shortcut}
        className="absolute left-full ml-1"
      />
    </div>
  );
}

const routeTitles: Record<string, { title: string; subtitle?: string }> = {
  "/": { title: "bb" },
  "/settings": { title: "Settings" },
  "/automations": { title: "Automations" },
  "/skills": { title: "Skills" },
};

function resolveRouteTitle(
  pathname: string,
): { title: string; subtitle?: string } | undefined {
  // The global settings page owns /settings/:section. Legacy plugin settings
  // links still match briefly before AppRoutes redirects them to Tools.
  if (matchPath(`${SETTINGS_ROUTE_PATH}/*`, pathname)) {
    return routeTitles[SETTINGS_ROUTE_PATH];
  }
  return routeTitles[pathname];
}

interface AppHeaderProps {
  /**
   * True for routes that should use quiet chrome. This suppresses the center
   * title; project-scoped quiet routes also get project actions on the right.
   */
  usesProjectChromeStyle: boolean;
  usesDesktopChrome: boolean;
  isSettingsView: boolean;
  projectId?: string;
  project?: ProjectResponse;
  /** Registered navPanel when this is a plugin panel route (design §5.2):
   * the shared header shows plugin icon + title, plus the registration's
   * `headerContent` as the actions. */
  pluginPanel?: PluginNavPanelSlot;
  /** The panel route's splat remainder ("" at the panel root). */
  pluginPanelSubPath?: string;
  meta: {
    title: string;
    subtitle?: string;
    breadcrumbs?: Array<{ label: string; to?: string }>;
  };
}

function AppHeader({
  usesProjectChromeStyle,
  usesDesktopChrome,
  isSettingsView,
  projectId,
  project,
  pluginPanel,
  pluginPanelSubPath,
  meta,
}: AppHeaderProps) {
  const headerBreadcrumbs = meta.breadcrumbs;
  const headerTitle =
    headerBreadcrumbs || usesProjectChromeStyle ? undefined : meta.title;

  const hasCenterContent =
    Boolean(headerBreadcrumbs) ||
    Boolean(headerTitle) ||
    Boolean(meta.subtitle);

  const center = headerBreadcrumbs ? (
    <div className="min-w-0 flex-1">
      <AppBreadcrumbs
        breadcrumbs={headerBreadcrumbs}
        usesDesktopChrome={usesDesktopChrome}
      />
    </div>
  ) : pluginPanel ? (
    <PluginPanelHeaderCenter panel={pluginPanel} />
  ) : hasCenterContent ? (
    <div className="min-w-0 flex-1">
      {headerTitle ? (
        <p className="truncate text-sm font-semibold">{headerTitle}</p>
      ) : null}
      {meta.subtitle ? (
        <p className="truncate text-xs text-muted-foreground">
          {meta.subtitle}
        </p>
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
        to={getProjectSettingsRoutePath(projectId)}
        className={cn(
          HEADER_ICON_BUTTON_CLASS,
          "inline-flex items-center justify-center transition-colors",
          isSettingsView
            ? "bg-state-active text-foreground"
            : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
        )}
        aria-label="Project settings"
        aria-current={isSettingsView ? "page" : undefined}
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
  const quickCreateProject = useQuickCreateProjectController();
  const isCompactViewport = useIsCompactViewport();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const splitWorkspaceActive = useSplitWorkspaceActive();
  const store = useStore();
  const contentShellRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<HTMLDivElement>(null);
  const restoreIOSViewportOnKeyboardDismissal = useMemo(
    () => shouldRestoreIOSViewportOnKeyboardDismissal(navigator),
    [],
  );
  useMobileVisualViewportHeight(
    contentShellRef,
    providerRef,
    isCompactViewport,
    restoreIOSViewportOnKeyboardDismissal,
  );
  const location = useLocation();
  const [resourceRouteLabel, setResourceRouteLabel] = useAtom(
    resourceRouteLabelAtom,
  );
  useEffect(() => {
    setResourceRouteLabel(null);
    function handleResourceRouteLabel(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail;
      if (
        typeof detail !== "object" ||
        detail === null ||
        !("label" in detail) ||
        (typeof detail.label !== "string" && detail.label !== null)
      ) {
        return;
      }
      setResourceRouteLabel(detail.label);
    }
    window.addEventListener(
      RESOURCE_ROUTE_LABEL_EVENT,
      handleResourceRouteLabel,
    );
    return () => {
      window.removeEventListener(
        RESOURCE_ROUTE_LABEL_EVENT,
        handleResourceRouteLabel,
      );
    };
  }, [location.pathname, setResourceRouteLabel]);
  const navigate = useNavigate();
  const {
    appRoutePath,
    settingsRoutePath,
    toolsBackRoutePath,
    toolsRoutePath,
  } = useAppSettingsRouteMemory();
  useEffect(
    () =>
      wsManager.onThreadOpen((signal) => {
        const route = getThreadRoutePath({
          projectId: signal.projectId,
          threadId: signal.threadId,
        });
        if (!threadSplitsEnabled) {
          void navigate(route);
          return;
        }
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
    [isCompactViewport, navigate, store, threadSplitsEnabled],
  );
  useAppCommandHandler("thread.new", () => {
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
    return true;
  });
  useAppCommandHandler("settings.open", () => {
    void navigate(settingsRoutePath);
    return true;
  });
  // Native server rail "+" tile.
  useAppCommandHandler("settings.openServers", () => {
    void navigate(`${SETTINGS_ROUTE_PATH}/servers`);
    return true;
  });
  const {
    projectId,
    threadId,
    isThreadView,
    isArchivedView,
    isSettingsView,
    isRootView,
  } = useRouteState();
  const archivedSectionId = isArchivedView
    ? new URLSearchParams(location.search).get("sectionId")
    : null;
  // Plugin panel routes ride the shared header (design §5.2): icon + panel
  // title in the center, the registration's headerContent as the actions.
  const { navPanels } = usePluginSlots();
  // Global settings routes swap the app sidebar for the settings sidebar.
  const isGlobalSettingsView =
    matchPath(`${SETTINGS_ROUTE_PATH}/*`, location.pathname) !== null;
  const isGlobalToolsView = isToolsRoutePath(location.pathname);
  const pluginPanelMatch = matchPath(
    PLUGIN_PANEL_ROUTE_PATH,
    location.pathname,
  );
  const pluginPanel = pluginPanelMatch
    ? navPanels.find(
        (candidate) =>
          candidate.pluginId === pluginPanelMatch.params.pluginId &&
          candidate.path === pluginPanelMatch.params.panelPath,
      )
    : undefined;
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
  const titleMentionResources = useMemo(() => {
    const sectionNamesById = new Map<string, string>();
    const projectNamesById = new Map<string, string>();
    const threadById = new Map(
      sidebarThreads.map((entry) => [entry.id, entry]),
    );
    const navigation = sidebarNavigationQuery.data;
    if (navigation) {
      for (const section of navigation.sections) {
        sectionNamesById.set(section.id, section.name);
      }
      for (const projectEntry of navigation.projects) {
        projectNamesById.set(projectEntry.id, projectEntry.name);
      }
      projectNamesById.set(
        navigation.personalProject.id,
        navigation.personalProject.name,
      );
    }
    return { sectionNamesById, projectNamesById, threadById };
  }, [sidebarNavigationQuery.data, sidebarThreads]);
  const threadDetailBootstrapQuery = useThreadDetailBootstrap(threadId ?? "", {
    enabled: isThreadView && Boolean(threadId),
    timelinePrefetch: isThreadView && Boolean(threadId),
  });
  const hasThreadDetailBootstrapSettled =
    threadDetailBootstrapQuery.isSuccess || threadDetailBootstrapQuery.isError;
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const liveWidthRef = useRef(sidebarWidth);
  const animationFrameRef = useRef<number | null>(null);
  // Plugin panel routes hand their header to the split workspace, which draws a
  // pane header per pane. When the workspace is inactive it draws none, so the
  // shared header must come back — it reserves the sidebar trigger footprint,
  // and without it the trigger overlays the panel body.
  const showHeader =
    !isThreadView &&
    !isRootView &&
    !(splitWorkspaceActive && pluginPanelMatch !== null);
  const [desktopInfo] = useState(getBbDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const reserveMacosTrafficLights = shouldReserveMacosTrafficLights({
    desktopInfo,
    windowState: desktopWindowState,
  });
  const sidebarProviderStyle: SidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  };

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
    ? getThreadDisplayTitle(thread)
    : threadId
      ? `Thread ${threadId.slice(0, 8)}`
      : "Thread";
  const toolsBreadcrumbs = resolveToolsBreadcrumbs(
    location.pathname,
    location.search,
    resourceRouteLabel,
  );
  const automationBreadcrumbs = resolveAutomationBreadcrumbs(
    location.pathname,
    resourceRouteLabel,
  );
  // Tools breadcrumbs feed only the document title now; the header's choice
  // between the Extensions title and automation breadcrumbs lives in the pure
  // (and tested) resolveToolsAreaHeaderMeta.
  const documentTitleBreadcrumbs = toolsBreadcrumbs ?? automationBreadcrumbs;
  const toolsAreaHeaderMeta = resolveToolsAreaHeaderMeta(
    location.pathname,
    // Extensions graduated from experiments (#1360): the hub is always on.
    true,
    resourceRouteLabel,
    location.search,
  );
  const meta = isThreadView
    ? {
        title: thread ? getThreadDisplayTitle(thread) : "Thread",
        subtitle: undefined,
      }
    : toolsAreaHeaderMeta?.kind === "extensions-title"
      ? { title: toolsAreaHeaderMeta.title, subtitle: undefined }
      : toolsAreaHeaderMeta?.kind === "breadcrumbs"
        ? {
            title: "",
            subtitle: undefined,
            breadcrumbs: toolsAreaHeaderMeta.breadcrumbs,
          }
        : isArchivedView && projectId
          ? isProjectlessProjectId(projectId)
            ? {
                title: "",
                subtitle: undefined,
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
                subtitle: undefined,
                breadcrumbs: [
                  {
                    label: projectLabel ?? projectId,
                    to: getLegacyProjectComposeRoutePath(projectId),
                  },
                  { label: "Archived" },
                ],
              }
          : isSettingsView && projectId
            ? {
                title: "",
                subtitle: undefined,
                breadcrumbs: [
                  {
                    label: projectLabel ?? projectId,
                    to: getLegacyProjectComposeRoutePath(projectId),
                  },
                  { label: "Settings" },
                ],
              }
            : projectId
              ? {
                  title: projectLabel ?? projectId,
                  subtitle: undefined,
                }
              : (resolveRouteTitle(location.pathname) ?? { title: "" });

  const documentTitle = (() => {
    if (isThreadView) {
      return threadDisplayTitle;
    }
    if (pluginPanel) {
      return pluginPanel.title;
    }
    if (documentTitleBreadcrumbs) {
      const sectionLabel = documentTitleBreadcrumbs[0]?.label ?? "BB";
      const pageLabel = documentTitleBreadcrumbs.at(-1)?.label ?? sectionLabel;
      return pageLabel === sectionLabel
        ? sectionLabel
        : `${pageLabel} · ${sectionLabel}`;
    }
    if (isArchivedView && projectId) {
      if (isProjectlessProjectId(projectId)) {
        return archivedSectionName
          ? `${archivedSectionName} · Archived`
          : "Threads · Archived";
      }
      return `${projectLabel ?? projectId} · Archived`;
    }
    if (isSettingsView && projectId) {
      return `${projectLabel ?? projectId} · Settings`;
    }
    if (projectId) {
      return projectLabel ?? projectId;
    }
    const routeTitle = resolveRouteTitle(location.pathname)?.title;
    return routeTitle && routeTitle.length > 0 ? routeTitle : "BB";
  })();
  // The sidebar list omits archived threads and side chats, so it can't answer
  // whether the currently-viewed thread is blocked on input. Read the current
  // thread's pending interactions directly (the thread view already warms this
  // cache) so an in-view thread waiting on the user always lights the favicon,
  // mirroring how the in-view unread signal covers every thread kind.
  const currentThreadPendingInteractionsQuery = useThreadPendingInteractions(
    threadId ?? "",
    { enabled: isThreadView && Boolean(threadId) },
  );
  const currentThreadHasPendingInteraction =
    getLatestPendingInteraction(currentThreadPendingInteractionsQuery.data) !==
    null;
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
      startWidthRef.current = liveWidthRef.current;
      document.body.classList.add("sidebar-resizing");
      applyResizeCursor("horizontal");
      document.body.style.userSelect = "none";
    },
    [],
  );

  const finishSidebarResize = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    providerRef.current?.style.setProperty(
      "--sidebar-width",
      `${liveWidthRef.current}px`,
    );
    dispatchBrowserViewBoundsSync();
    setSidebarWidth(liveWidthRef.current);
    setIsSidebarResizing(false);
    resetSidebarResizeDocumentState();
  }, [setSidebarWidth]);

  useEffect(() => {
    if (!isSidebarResizing) return;

    const applyLiveWidth = () => {
      animationFrameRef.current = null;
      providerRef.current?.style.setProperty(
        "--sidebar-width",
        `${liveWidthRef.current}px`,
      );
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
      resetSidebarResizeDocumentState();
    };
  }, [finishSidebarResize, isSidebarResizing]);

  useEffect(() => {
    liveWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = documentTitle;
  }, [documentTitle]);

  return (
      <ProjectActionsProvider>
        <ThreadTitleMentionResourcesProvider {...titleMentionResources}>
          <ThreadActionsProvider>
            <IframeDragGuardOverlay active={isSidebarResizing} />
            <SidebarStateBridge
              providerRef={providerRef}
              style={sidebarProviderStyle}
            >
              <AppLayoutSidebar
                mode={
                  isGlobalSettingsView
                    ? "settings"
                    : isGlobalToolsView
                      ? "tools"
                      : "app"
                }
                onResizeMouseDown={handleResizeMouseDown}
                isResizing={isSidebarResizing}
                appRoutePath={appRoutePath}
                settingsRoutePath={settingsRoutePath}
                toolsBackRoutePath={toolsBackRoutePath}
                toolsRoutePath={toolsRoutePath}
              />
              <SidebarInset>
                <div
                  ref={contentShellRef}
                  data-testid="app-layout-content-shell"
                  className="relative flex h-full min-h-0 min-w-0 w-full flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
                >
                  {showHeader ? (
                    <AppHeader
                      usesDesktopChrome={usesDesktopChrome}
                      usesProjectChromeStyle={
                        isRootView || isArchivedView || isSettingsView
                      }
                      isSettingsView={isSettingsView}
                      projectId={projectId}
                      project={project}
                      pluginPanel={pluginPanel}
                      pluginPanelSubPath={pluginPanelMatch?.params["*"] ?? ""}
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
  );
}
