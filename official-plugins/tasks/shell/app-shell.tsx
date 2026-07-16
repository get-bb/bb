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

/** Below this container width (panel splits, not the window) the sidebar
    auto-collapses. */
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 720;

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
    document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !==
    null
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

function RouteOutlet({ route }: { route: TasksRoute }) {
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
      return route.view === "board" ? (
        <BoardView projectId={route.projectId} />
      ) : (
        <ListView projectId={route.projectId} />
      );
  }
}

export function TasksAppShell({ subPath }: PluginNavPanelProps) {
  const route = parseTasksRoute(subPath);
  const navigation = useTasksNavigation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  // Auto-collapse in narrow containers (the plugin can live in a split pane,
  // so the panel's own width is what matters — never the window's). A manual
  // toggle while narrow sticks until the next threshold crossing; growing
  // wide again restores the user's pre-collapse choice.
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [narrowOverride, setNarrowOverride] = useState<boolean | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const width = root.clientWidth;
      // Width 0 means hidden or not yet laid out — keep the wide default.
      setNarrow(width > 0 && width < SIDEBAR_AUTO_COLLAPSE_WIDTH);
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
    if (narrow) setNarrowOverride(!effectiveSidebarCollapsed);
    else setSidebarCollapsed((value) => !value);
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

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-row-reverse bg-background text-foreground"
    >
      {!effectiveSidebarCollapsed ? (
        <TasksSidebar
          route={route}
          folders={folders.data}
          projects={projects.data}
          summaries={summaries.data}
          presets={presets.data}
          activeTasks={activeTasks.data}
          isLoading={projects.isLoading || summaries.isLoading}
          onNavigate={navigation.go}
          onNewProject={() => setNewProjectOpen(true)}
        />
      ) : null}
      <main className="flex min-w-0 flex-1 flex-col">
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
            <NoProjectsEmptyState onNewProject={() => setNewProjectOpen(true)} />
          ) : (
            <RouteOutlet route={route} />
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
