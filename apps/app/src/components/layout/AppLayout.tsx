import {
  Fragment,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type ReactNode,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Link, matchPath, useLocation } from "react-router-dom";
import type { ProjectResponse } from "@bb/server-contract";
import { Icon } from "@/components/ui/icon.js";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar.js";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { AppPageHeader, HEADER_ICON_BUTTON_CLASS } from "./AppPageHeader";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  getLatestPendingInteraction,
  useThread,
  useThreadDetailBootstrap,
  useThreadPendingInteractions,
} from "@/hooks/queries/thread-queries";
import { useRouteState } from "@/hooks/useRouteState";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { applyResizeCursor, clearResizeCursor } from "@/lib/resizeCursor";
import { cn } from "@/lib/utils";
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
  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import {
  getLegacyProjectComposeRoutePath,
  getProjectArchivedRoutePath,
  getProjectSettingsRoutePath,
  getRootComposeRoutePath,
  isProjectlessProjectId,
  PLUGIN_PANEL_ROUTE_PATH,
} from "@/lib/route-paths";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { IframeDragGuardOverlay } from "@/lib/iframe-drag-guard";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import { useFaviconBadge } from "@/lib/favicon-color-preference";
import { shouldShowFaviconAttentionDot } from "./faviconAttentionDot";

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
 * Desktop chrome offsets it clear of the macOS traffic lights and keeps the
 * strip a window-drag region; only the button itself is no-drag, so the title
 * strip above and below the (shorter) button stays draggable rather than
 * becoming an oversized dead zone. Browser chrome has no traffic lights, so it
 * sits flush at the top-left with a small inset.
 */
function SidebarTriggerOverlay({
  usesDesktopChrome,
}: SidebarTriggerOverlayProps) {
  if (usesDesktopChrome) {
    return (
      <div
        data-testid="app-desktop-sidebar-trigger"
        className={cn(
          "fixed top-0 z-50",
          CHROME_ROW_CLASS,
          MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
          MACOS_WINDOW_DRAG_CLASS,
        )}
      >
        {/* The overlay's CHROME_ROW_CLASS box-centers the trigger; the shared
            traffic-light axis nudge then drops it onto the native lights' axis
            (which renders ~2 CSS px below the row center), matching the sidebar
            arrows and page-title header in desktop chrome. */}
        <SidebarTrigger
          className={cn(
            MACOS_WINDOW_NO_DRAG_CLASS,
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
        "fixed left-0 top-0 z-50",
        CHROME_ROW_CLASS,
        BROWSER_SIDEBAR_TRIGGER_INSET_CLASS,
      )}
    >
      <SidebarTrigger />
    </div>
  );
}

const routeTitles: Record<string, { title: string; subtitle?: string }> = {
  "/": { title: "bb" },
  "/settings": { title: "Settings" },
};

interface AppHeaderProps {
  /**
   * True for routes that should use quiet chrome. This suppresses the center
   * title; project-scoped quiet routes also get project actions on the right.
   */
  usesProjectChromeStyle: boolean;
  usesDesktopChrome: boolean;
  isArchivedView: boolean;
  isSettingsView: boolean;
  projectId?: string;
  project?: ProjectResponse;
  /** Registered navPanel when this is a plugin panel route (design §5.2):
   * the shared header shows plugin logo + title, plus the registration's
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
  isArchivedView,
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

  const center = pluginPanel ? (
    <PluginPanelHeaderCenter panel={pluginPanel} />
  ) : hasCenterContent ? (
    <div className="min-w-0 flex-1">
      {headerBreadcrumbs ? (
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          {headerBreadcrumbs.map((segment, index) => {
            const isLast = index === headerBreadcrumbs.length - 1;
            return (
              <Fragment key={`${segment.label}-${index}`}>
                {index > 0 ? (
                  <Icon
                    name="ChevronRight"
                    className="size-3.5 shrink-0 text-subtle-foreground"
                  />
                ) : null}
                {!isLast && segment.to ? (
                  <Link
                    to={segment.to}
                    className={cn(
                      "shrink-0 text-muted-foreground transition-colors hover:text-foreground",
                      usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                    )}
                  >
                    {segment.label}
                  </Link>
                ) : (
                  <span
                    className={
                      isLast
                        ? "min-w-0 truncate"
                        : "shrink-0 text-muted-foreground"
                    }
                  >
                    {segment.label}
                  </span>
                )}
              </Fragment>
            );
          })}
        </p>
      ) : null}
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
        <Link
          to={getProjectArchivedRoutePath(projectId)}
          className={cn(
            HEADER_ICON_BUTTON_CLASS,
            "inline-flex items-center justify-center transition-colors",
            isArchivedView
              ? "bg-state-active text-foreground"
              : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
          )}
          aria-label="Archived threads"
          aria-current={isArchivedView ? "page" : undefined}
        >
          <Icon name="Archive" />
        </Link>
        {project ? (
          <ProjectActionsMenu
            project={project}
            triggerClassName={HEADER_ICON_BUTTON_CLASS}
          />
        ) : null}
      </>
    ) : null;

  return (
    <AppPageHeader
      bordered={!usesProjectChromeStyle}
      center={center}
      actions={actions}
    />
  );
}

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const quickCreateProject = useQuickCreateProjectController();
  const location = useLocation();
  const {
    projectId,
    threadId,
    isThreadView,
    isArchivedView,
    isSettingsView,
    isRootView,
  } = useRouteState();
  const archivedFolderId = isArchivedView
    ? new URLSearchParams(location.search).get("folderId")
    : null;
  // Plugin panel routes ride the shared header (design §5.2): logo + panel
  // title in the center, the registration's headerContent as the actions.
  const { navPanels } = usePluginSlots();
  const pluginPanelMatch = matchPath(PLUGIN_PANEL_ROUTE_PATH, location.pathname);
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
  const threadDetailBootstrapQuery = useThreadDetailBootstrap(threadId ?? "", {
    enabled: isThreadView && Boolean(threadId),
    timelinePrefetch: isThreadView && Boolean(threadId),
  });
  const hasThreadDetailBootstrapSettled =
    threadDetailBootstrapQuery.isSuccess || threadDetailBootstrapQuery.isError;
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const providerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const liveWidthRef = useRef(sidebarWidth);
  const animationFrameRef = useRef<number | null>(null);
  const showHeader = !isThreadView && !isRootView;
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const sidebarProviderStyle: SidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  };

  const project = projectId
    ? projects?.find((candidate) => candidate.id === projectId)
    : undefined;
  const archivedFolderName = archivedFolderId
    ? (sidebarNavigationQuery.data?.folders.find(
        (folder) => folder.id === archivedFolderId,
      )?.name ?? archivedFolderId)
    : null;
  const projectName = projectId ? project?.name : undefined;
  const projectLabel = projectName ?? (projectId ? projectId : undefined);
  const { data: thread } = useThread(threadId ?? "", {
    enabled:
      Boolean(threadId) && (!isThreadView || hasThreadDetailBootstrapSettled),
    refetchOnMount:
      isThreadView && threadDetailBootstrapQuery.isSuccess ? true : "always",
  });
  const threadDisplayTitle = thread
    ? getThreadDisplayTitle(thread)
    : threadId
      ? `Thread ${threadId.slice(0, 8)}`
      : "Thread";
  const meta = isThreadView
    ? {
        title: thread ? getThreadDisplayTitle(thread) : "Thread",
        subtitle: undefined,
      }
    : isArchivedView && projectId
        ? isProjectlessProjectId(projectId)
          ? {
              title: "",
              subtitle: undefined,
              breadcrumbs: [
                { label: "Threads", to: getRootComposeRoutePath() },
                ...(archivedFolderName ? [{ label: archivedFolderName }] : []),
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
          : (routeTitles[location.pathname] ?? { title: "" });

  const documentTitle = (() => {
    if (isThreadView) {
      return threadDisplayTitle;
    }
    if (pluginPanel) {
      return pluginPanel.title;
    }
    if (isArchivedView && projectId) {
      if (isProjectlessProjectId(projectId)) {
        return archivedFolderName
          ? `${archivedFolderName} · Archived`
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
    const routeTitle = routeTitles[location.pathname]?.title;
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
      <ThreadActionsProvider>
        <IframeDragGuardOverlay active={isSidebarResizing} />
        <SidebarStateBridge
          providerRef={providerRef}
          style={sidebarProviderStyle}
        >
          <AppSidebar
            onResizeMouseDown={handleResizeMouseDown}
            isResizing={isSidebarResizing}
            showTopReserve={true}
          />
          <SidebarInset>
            <div
              data-testid="app-layout-content-shell"
              className="relative flex h-[100dvh] min-w-0 w-full flex-col"
            >
              {showHeader ? (
                <AppHeader
                  usesDesktopChrome={usesDesktopChrome}
                  usesProjectChromeStyle={
                    isRootView || isArchivedView || isSettingsView
                  }
                  isArchivedView={isArchivedView}
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
          <SidebarTriggerOverlay usesDesktopChrome={usesDesktopChrome} />
        </SidebarStateBridge>
        <ProjectPathDialog
          target={quickCreateProject.projectPathDialog.target}
          pending={quickCreateProject.isCreating}
          platform={quickCreateProject.platform}
          hostId={quickCreateProject.hostId}
          hostName={quickCreateProject.hostName}
          onOpenChange={quickCreateProject.projectPathDialog.onOpenChange}
          onSubmit={quickCreateProject.submitProjectPath}
        />
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}
