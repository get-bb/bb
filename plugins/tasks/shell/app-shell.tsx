import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { useProjects } from "./data.js";
import {
  parseTasksRoute,
  useTasksNavigation,
  type ResolvedTasksRoute,
  type TasksNavigation,
  type TasksRoute,
} from "./routes.js";
import { loadViewMode, storeViewMode } from "./view-preference.js";
import { TasksTopbar } from "./topbar.js";
import { ListView } from "../views/list/index.js";
import { BoardView } from "../views/board/index.js";
import { DetailView } from "../views/detail/index.js";
import { NewTaskDialog } from "../views/manage/new-task-dialog.js";
import { NewProjectDialog } from "../views/manage/new-project-dialog.js";
import { ManagePanel } from "../views/manage/manage-panel.js";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { TasksRefreshProvider } from "./refresh.js";

const BOARD_MIN_WIDTH = 448;

interface LastBrowseRouteStoreEntry {
  route: TasksRoute | null;
  listeners: Set<() => void>;
}

const lastBrowseRouteStore = new Map<string, LastBrowseRouteStoreEntry>();

function subscribeToLastBrowseRoute(
  key: string,
  listener: () => void,
): () => void {
  const entry =
    lastBrowseRouteStore.get(key) ??
    ({
      route: null,
      listeners: new Set<() => void>(),
    } satisfies LastBrowseRouteStoreEntry);
  lastBrowseRouteStore.set(key, entry);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

function getLastBrowseRoute(key: string): TasksRoute | null {
  return lastBrowseRouteStore.get(key)?.route ?? null;
}

function setLastBrowseRoute(key: string, route: TasksRoute): void {
  const entry =
    lastBrowseRouteStore.get(key) ??
    ({
      route: null,
      listeners: new Set<() => void>(),
    } satisfies LastBrowseRouteStoreEntry);
  if (entry.route === route) return;
  entry.route = route;
  lastBrowseRouteStore.set(key, entry);
  for (const listener of entry.listeners) listener();
}

function useLastBrowseRoute(
  key: string,
  route: ResolvedTasksRoute,
): TasksRoute | null {
  const lastBrowseRoute = useSyncExternalStore(
    (listener) => subscribeToLastBrowseRoute(key, listener),
    () => getLastBrowseRoute(key),
    () => null,
  );
  useEffect(() => {
    if (route.kind !== "task") setLastBrowseRoute(key, route);
  }, [key, route]);
  useEffect(() => {
    return () => {
      lastBrowseRouteStore.delete(key);
    };
  }, [key]);
  return lastBrowseRoute;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

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
  route: ResolvedTasksRoute;
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

function resolveRoute(route: TasksRoute): ResolvedTasksRoute {
  if (route.kind !== "project") return route;
  return { ...route, view: route.view ?? loadViewMode(route.projectId) };
}

function TasksAppShellContent({ subPath }: PluginNavPanelProps) {
  const route = useMemo(
    () => resolveRoute(parseTasksRoute(subPath)),
    [subPath],
  );
  const tasksNavigation = useTasksNavigation();
  const navigation = useMemo<TasksNavigation>(
    () => ({
      go: (target, options) => {
        if (target.kind === "project" && target.view !== null) {
          storeViewMode(target.projectId, target.view);
        }
        tasksNavigation.go(target, options);
      },
    }),
    [tasksNavigation],
  );
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const mainRef = useRef<HTMLElement>(null);
  const [boardUsable, setBoardUsable] = useState(true);
  useEffect(() => {
    const main = mainRef.current;
    if (!main || !("ResizeObserver" in globalThis)) return;
    const update = () => {
      const mainWidth = main.clientWidth;
      setBoardUsable(!(mainWidth > 0 && mainWidth < BOARD_MIN_WIDTH));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(main);
    return () => observer.disconnect();
  }, []);
  const projects = useProjects();

  const routeHistoryKey = useId();
  const lastBrowseRoute = useLastBrowseRoute(routeHistoryKey, route);
  const pagerScope =
    lastBrowseRoute === null
      ? null
      : {
          projectId:
            lastBrowseRoute.kind === "project"
              ? lastBrowseRoute.projectId
              : null,
        };
  const backFromTask = () => navigation.go(lastBrowseRoute ?? { kind: "all" });
  const onTaskRoute = route.kind === "task";
  useEffect(() => {
    if (!onTaskRoute) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      if (hasOpenOverlay()) return;
      navigation.go(lastBrowseRoute ?? { kind: "all" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lastBrowseRoute, navigation, onTaskRoute]);

  const noProjects = projects.data !== undefined && projects.data.length === 0;
  const newTaskProjectId = route.kind === "project" ? route.projectId : null;

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
    <div className="relative flex h-full min-h-0 bg-background text-foreground">
      <main ref={mainRef} className="@container flex min-w-0 flex-1 flex-col">
        <TasksTopbar
          route={route}
          projects={projects.data}
          pagerScope={pagerScope}
          onNavigate={navigation.go}
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
