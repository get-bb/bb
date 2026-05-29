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
import { Link, useLocation } from "react-router-dom";
import type { ProjectResponse } from "@bb/server-contract";
import { Icon } from "@/components/ui/icon.js";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useIsSidebarShowing,
} from "@/components/ui/sidebar.js";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { AppPageHeader, HEADER_ICON_BUTTON_CLASS } from "./AppPageHeader";
import {
  useProjects,
  useSidebarBootstrap,
  stripProjectThreads,
} from "@/hooks/queries/project-queries";
import {
  useThread,
  useThreadDetailBootstrap,
} from "@/hooks/queries/thread-queries";
import { useAppRoute } from "@/hooks/useAppRoute";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { cn } from "@/lib/utils";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import { ProjectActionsMenu } from "@/components/project/ProjectActionsMenu";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { createLocalStorageSyncStorage } from "@/lib/browser-storage";
import {
  getBbDesktopInfo,
  MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import {
  getLegacyProjectComposeRoutePath,
  getProjectArchivedRoutePath,
  getProjectSettingsRoutePath,
} from "@/lib/app-route-paths";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { useStandardManagerTimelinePreference } from "@/lib/manager-timeline-view-preference";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { IFRAME_POINTER_EVENTS_NONE_CLASS } from "@/lib/iframe-drag-guard";

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
  return (
    <SidebarProvider
      ref={providerRef}
      style={style}
      className={className}
      data-testid="app-layout-root"
      open={open}
      onOpenChange={setOpen}
    >
      {children}
    </SidebarProvider>
  );
}

function FloatingSidebarTrigger() {
  const isSidebarShowing = useIsSidebarShowing();
  if (isSidebarShowing) return null;
  return (
    <div className="absolute left-3 top-3.5 z-20">
      <SidebarTrigger className="h-5 w-5 rounded-md p-0" />
    </div>
  );
}

function resetSidebarResizeDocumentState(): void {
  document.body.classList.remove("sidebar-resizing");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

/**
 * Desktop-only sidebar toggle, pinned to the window's top-left just right of
 * the macOS traffic lights. Rendered once at the layout root — outside the
 * sliding sidebar panel and the content inset — so it holds a constant
 * window position while the sidebar animates in/out behind it, instead of
 * riding whichever container would otherwise host it.
 *
 * The wrapper is offset clear of the traffic lights and stays a window-drag
 * region; only the button itself is no-drag, so the title strip above and
 * below the (shorter) button stays draggable rather than becoming an
 * oversized dead zone.
 */
function DesktopSidebarTriggerOverlay() {
  return (
    <div
      data-testid="app-desktop-sidebar-trigger"
      className={cn(
        "fixed top-0 z-50 flex h-12 items-center",
        MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
        MACOS_WINDOW_DRAG_CLASS,
      )}
    >
      <SidebarTrigger
        className={cn(
          MACOS_WINDOW_NO_DRAG_CLASS,
          MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS,
        )}
      />
    </div>
  );
}

const routeTitles: Record<string, { title: string; subtitle?: string }> = {
  "/": { title: "Threads" },
  "/settings": { title: "Settings" },
  "/development-only/replay": { title: "Replay threads" },
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
  meta,
}: AppHeaderProps) {
  const headerBreadcrumbs = meta.breadcrumbs;
  const headerTitle =
    headerBreadcrumbs || usesProjectChromeStyle ? undefined : meta.title;

  const hasCenterContent =
    Boolean(headerBreadcrumbs) ||
    Boolean(headerTitle) ||
    Boolean(meta.subtitle);

  const center = hasCenterContent ? (
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

  const actions =
    usesProjectChromeStyle && projectId ? (
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
          title="Project settings"
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
          title="Archived threads"
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
  } = useAppRoute();
  const sidebarBootstrapQuery = useSidebarBootstrap();
  const hasSidebarBootstrapSettled =
    sidebarBootstrapQuery.isSuccess || sidebarBootstrapQuery.isError;
  const projectsQuery = useProjects({ enabled: hasSidebarBootstrapSettled });
  const sidebarBootstrapProjects = useMemo(
    () => sidebarBootstrapQuery.data?.projects.map(stripProjectThreads),
    [sidebarBootstrapQuery.data],
  );
  const projects = projectsQuery.data ?? sidebarBootstrapProjects;
  const [storedUseStandardManagerTimeline] =
    useStandardManagerTimelinePreference();
  const prefetchedManagerTimelineView = storedUseStandardManagerTimeline
    ? "standard"
    : undefined;
  const threadDetailBootstrapQuery = useThreadDetailBootstrap(threadId ?? "", {
    composerBootstrapPrefetch: isThreadView && Boolean(threadId),
    enabled: isThreadView && Boolean(threadId),
    timelinePrefetch:
      isThreadView && threadId
        ? {
            managerTimelineView: prefetchedManagerTimelineView,
          }
        : undefined,
  });
  const hasThreadDetailBootstrapSettled =
    threadDetailBootstrapQuery.isSuccess || threadDetailBootstrapQuery.isError;
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const providerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const liveWidthRef = useRef(sidebarWidth);
  const animationFrameRef = useRef<number | null>(null);
  const showHeader = !isThreadView;
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const showFloatingSidebarTrigger =
    !showHeader && isRootView && !usesDesktopChrome;
  const sidebarProviderStyle: SidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  };

  const project = projectId
    ? projects?.find((candidate) => candidate.id === projectId)
    : undefined;
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
  useEffect(() => {
    if (!thread?.projectId) return;
    setRootComposeProjectId(thread.projectId);
  }, [setRootComposeProjectId, thread?.projectId]);
  const meta = isThreadView
    ? {
        title: thread ? getThreadDisplayTitle(thread) : "Thread",
        subtitle: undefined,
      }
    : isArchivedView && projectId
      ? {
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
    if (isArchivedView && projectId) {
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

  const handleResizeMouseDown = useCallback(
    (event: SidebarResizeMouseEvent) => {
      event.preventDefault();
      setIsSidebarResizing(true);
      startXRef.current = event.clientX;
      startWidthRef.current = liveWidthRef.current;
      document.body.classList.add("sidebar-resizing");
      document.body.style.cursor = "col-resize";
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
        <SidebarStateBridge
          className={
            isSidebarResizing ? IFRAME_POINTER_EVENTS_NONE_CLASS : undefined
          }
          providerRef={providerRef}
          style={sidebarProviderStyle}
        >
          <AppSidebar
            onResizeMouseDown={handleResizeMouseDown}
            isResizing={isSidebarResizing}
            showInlineTrigger={true}
          />
          <SidebarInset>
            <div
              data-testid="app-layout-content-shell"
              className="relative flex h-[100dvh] min-w-0 w-full flex-col"
            >
              {showFloatingSidebarTrigger ? <FloatingSidebarTrigger /> : null}
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
                  meta={meta}
                />
              ) : null}
              <main className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
                {children}
              </main>
            </div>
          </SidebarInset>
          {usesDesktopChrome ? <DesktopSidebarTriggerOverlay /> : null}
        </SidebarStateBridge>
        <ProjectPathDialog
          target={quickCreateProject.projectPathDialog.target}
          pending={quickCreateProject.isCreating}
          platform={quickCreateProject.platform}
          onOpenChange={quickCreateProject.projectPathDialog.onOpenChange}
          onSubmit={quickCreateProject.submitProjectPath}
        />
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}
