import { useEffect, useRef, useState } from "react";
import type { PluginNavPanelProps } from "@bb/plugin-sdk/app";
import {
  useActiveTasks,
  useFolders,
  usePresets,
  useProjects,
  useSidebarSummary,
} from "./data.js";
import {
  parseTasksRoute,
  useTasksNavigation,
  type TasksRoute,
} from "./routes.js";
import { TasksSidebar } from "./sidebar.js";
import {
  loadSidebarCollapsed,
  storeSidebarCollapsed,
} from "./sidebar-preference.js";
import { TasksTopbar } from "./topbar.js";
import { ListView } from "../views/list/index.js";
import { BoardView } from "../views/board/index.js";
import { DetailView } from "../views/detail/index.js";
import {
  ManagePanel,
  NewProjectDialog,
  NewTaskDialog,
} from "../views/manage/index.js";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { TasksRefreshProvider } from "./refresh.js";

/** Below this container width (panel splits, not the window) the sidebar
    auto-collapses. */
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 720;

/** Below this container width the board is unusable (columns get crushed), so
    project routes render the list and the topbar hides the List/Board toggle.
    Matches the rows' two-line breakpoint (@md, 448px) so the whole surface
    flips to its phone layout at one width. */
const BOARD_MIN_WIDTH = 448;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/**
 * True while any overlay (dialog/lightbox, dropdown menu, select listbox) is
 * open; both quick-create and Esc-to-back must yield to overlays. Radix and
 * the attachments lightbox all render `role` overlays only while open.
 */
function hasOpenOverlay(): boolean {
  return (
    document.querySelector(
      '[role="dialog"], [role="menu"], [role="listbox"]',
    ) !== null
  );
}

function NoProjectsEmptyState({ onNewProject }: { onNewProject: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Icon name="ListTodo" className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">No projects yet</p>
        <p className="text-sm text-muted-foreground">
          Create a project to start tracking tasks and dispatching work to
          agents.
        </p>
      </div>
      <Button size="sm" onClick={onNewProject}>
        <Icon name="Plus" className="size-3.5" />
        New project
      </Button>
    </div>
  );
}

function RouteOutlet({
  route,
  boardUsable,
}: {
  route: TasksRoute;
  /** False in phone-width containers: board routes fall back to the list
      (deep links/rotation would otherwise strand a crushed board with the
      toggle hidden). The URL keeps the board view for when width returns. */
  boardUsable: boolean;
}) {
  switch (route.kind) {
    case "all":
      return <ListView projectId={null} />;
    case "active":
      return <ListView projectId={null} activeOnly />;
    case "manage":
      return <ManagePanel />;
    case "task":
      return <DetailView taskKey={route.taskKey} />;
    case "project":
      return route.view === "board" && boardUsable ? (
        <BoardView projectId={route.projectId} />
      ) : (
        <ListView projectId={route.projectId} />
      );
  }
}

function TasksAppShellContent({ subPath }: PluginNavPanelProps) {
  const route = parseTasksRoute(subPath);
  const navigation = useTasksNavigation();
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(loadSidebarCollapsed);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  // Auto-collapse in narrow containers (the plugin can live in a split pane,
  // so the panel's own width is what matters — never the window's). A manual
  // toggle while narrow sticks until the next threshold crossing. Automatic
  // narrow collapse is transient; an explicit toggle updates the user's
  // client-local preference.
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [boardUsable, setBoardUsable] = useState(true);
  const [narrowOverride, setNarrowOverride] = useState<boolean | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const width = root.clientWidth;
      // Width 0 means hidden or not yet laid out — keep the wide default.
      setNarrow(width > 0 && width < SIDEBAR_AUTO_COLLAPSE_WIDTH);
      setBoardUsable(!(width > 0 && width < BOARD_MIN_WIDTH));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setNarrowOverride(null);
  }, [narrow]);
  const effectiveSidebarCollapsed = narrow
    ? (narrowOverride ?? true)
    : sidebarCollapsed;
  const toggleSidebar = () => {
    const next = !effectiveSidebarCollapsed;
    if (narrow) setNarrowOverride(next);
    setSidebarCollapsed(next);
    storeSidebarCollapsed(next);
  };

  const folders = useFolders();
  const projects = useProjects();
  const summaries = useSidebarSummary();
  const presets = usePresets();
  const activeTasks = useActiveTasks();

  // Esc from a task returns to the list/board the user came from. null until
  // the user browses one this session (e.g. a deep-linked refresh).
  const lastBrowseRouteRef = useRef<TasksRoute | null>(null);
  useEffect(() => {
    if (route.kind !== "task") lastBrowseRouteRef.current = route;
    // Routes are plain data; keying on subPath tracks every route change.
  }, [subPath]);
  const backFromTask = () =>
    navigation.go(lastBrowseRouteRef.current ?? { kind: "all" });
  const onTaskRoute = route.kind === "task";
  const backRef = useRef(backFromTask);
  backRef.current = backFromTask;
  useEffect(() => {
    if (!onTaskRoute) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      // Overlays (lightbox > dialog > menu) consume Esc before task-back.
      if (hasOpenOverlay()) return;
      backRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTaskRoute]);

  const noProjects = projects.data !== undefined && projects.data.length === 0;
  const newTaskProjectId = route.kind === "project" ? route.projectId : null;

  // Quick-create: bare "c" (no modifiers, no editable focus, no open overlay)
  // opens the New task dialog scoped to the current route's project.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "c" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableTarget(event.target)) return;
      if (hasOpenOverlay()) return;
      event.preventDefault();
      setNewTaskOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // In narrow containers the sidebar can't share the row (208px of a 320px
  // viewport would crush the list), so it opens as an overlay drawer instead.
  // Navigating from the drawer closes it — the destination is what the user
  // came for, and the transient narrow override resets to its collapsed
  // default rather than persisting a preference.
  const sidebarOverlay = narrow && !effectiveSidebarCollapsed;
  const navigateFromSidebar = (target: TasksRoute) => {
    if (sidebarOverlay) setNarrowOverride(null);
    navigation.go(target);
  };
  const sidebar = (
    <TasksSidebar
      route={route}
      folders={folders.data}
      projects={projects.data}
      summaries={summaries.data}
      presets={presets.data}
      activeTasks={activeTasks.data}
      isLoading={projects.isLoading || summaries.isLoading}
      overlay={sidebarOverlay}
      onNavigate={navigateFromSidebar}
      onNewProject={() => setNewProjectOpen(true)}
    />
  );

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-row-reverse bg-background text-foreground"
    >
      {!effectiveSidebarCollapsed ? (
        sidebarOverlay ? (
          <div className="absolute inset-0 z-30">
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={toggleSidebar}
              className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
            />
            <div className="absolute inset-y-0 right-0 flex max-w-[85%]">
              {sidebar}
            </div>
          </div>
        ) : (
          sidebar
        )
      ) : null}
      <main className="@container flex min-w-0 flex-1 flex-col">
        <TasksTopbar
          route={route}
          projects={projects.data}
          sidebarCollapsed={effectiveSidebarCollapsed}
          pagerScope={
            lastBrowseRouteRef.current === null
              ? null
              : {
                  projectId:
                    lastBrowseRouteRef.current.kind === "project"
                      ? lastBrowseRouteRef.current.projectId
                      : null,
                }
          }
          onNavigate={navigation.go}
          onToggleSidebar={toggleSidebar}
          onNewTask={() => setNewTaskOpen(true)}
          onBack={backFromTask}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {noProjects && route.kind !== "task" && route.kind !== "manage" ? (
            <NoProjectsEmptyState
              onNewProject={() => setNewProjectOpen(true)}
            />
          ) : (
            <RouteOutlet route={route} boardUsable={boardUsable} />
          )}
        </div>
      </main>
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projectId={newTaskProjectId}
      />
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </div>
  );
}

export function TasksAppShell(props: PluginNavPanelProps) {
  return (
    <TasksRefreshProvider>
      <TasksAppShellContent {...props} />
    </TasksRefreshProvider>
  );
}
