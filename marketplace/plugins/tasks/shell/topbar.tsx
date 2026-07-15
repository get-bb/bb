import { useMemo } from "react";
import type { Project, Task } from "../shared/contract.js";
import { groupTasksByStatus } from "../views/list/lib.js";
import { useTasksQuery } from "./data.js";
import type { TaskViewMode, TasksRoute } from "./routes.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export interface PagerPosition {
  /** 1-based position of the task within its sibling list. */
  index: number;
  total: number;
  prevKey: string | null;
  nextKey: string | null;
}

/**
 * Position of `taskKey` within its sibling tasks, mirroring the list view's
 * visual order: canonical status groups, board position within each group
 * (the order `listTasks` returns). Sub-tasks aren't list rows, so a sub-task
 * (or unknown key) has no pager position.
 */
export function pagerPosition(
  tasks: readonly Task[],
  taskKey: string,
): PagerPosition | null {
  const ordered = groupTasksByStatus(tasks).flatMap((group) => group.tasks);
  const wanted = taskKey.toUpperCase();
  const index = ordered.findIndex((task) => task.key.toUpperCase() === wanted);
  if (index === -1) return null;
  return {
    index: index + 1,
    total: ordered.length,
    prevKey: ordered[index - 1]?.key ?? null,
    nextKey: ordered[index + 1]?.key ?? null,
  };
}

function TaskPager({
  taskKey,
  projectId,
  onNavigate,
}: {
  taskKey: string;
  /** Scope from the list/board the user came from; null = All tasks. */
  projectId: string | null;
  onNavigate: (route: TasksRoute) => void;
}) {
  // Same query the list view issues (unfiltered): top-level tasks in the
  // browse scope. The pager ignores the list's transient filter state — it
  // steps through the full sibling list.
  const siblings = useTasksQuery(
    async (rpc) =>
      (
        await rpc.call("listTasks", {
          ...(projectId === null ? {} : { projectId }),
          parentTaskId: null,
        })
      ).tasks,
    ["tasks:changed"],
    [projectId],
  );
  const position = useMemo(
    () => (siblings.data ? pagerPosition(siblings.data, taskKey) : null),
    [siblings.data, taskKey],
  );
  if (!position) return null;
  const step = (key: string | null) => {
    if (key !== null) onNavigate({ kind: "task", taskKey: key });
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
      <span className="px-1">
        {position.index} / {position.total}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="Previous task"
        disabled={position.prevKey === null}
        onClick={() => step(position.prevKey)}
      >
        <Icon name="ChevronUp" className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="Next task"
        disabled={position.nextKey === null}
        onClick={() => step(position.nextKey)}
      >
        <Icon name="ChevronDown" className="size-3.5" />
      </Button>
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: TaskViewMode;
  onChange: (view: TaskViewMode) => void;
}) {
  const segment = (mode: TaskViewMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(mode)}
      aria-pressed={view === mode}
      className={cn(
        "rounded-sm px-2.5 py-0.5 text-xs",
        view === mode
          ? "bg-background text-foreground shadow-2xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center rounded-md bg-muted p-0.5">
      {segment("list", "List")}
      {segment("board", "Board")}
    </div>
  );
}

export interface TasksTopbarProps {
  route: TasksRoute;
  projects: Project[] | undefined;
  sidebarCollapsed: boolean;
  /**
   * Pager scope on task routes: the list/board browsed before (projectId null
   * = All tasks). null when no list/board was visited this session (deep
   * link) — the pager then anchors to the task's own project.
   */
  pagerScope: { projectId: string | null } | null;
  onNavigate: (route: TasksRoute) => void;
  onToggleSidebar: () => void;
  onNewTask: () => void;
  onBack: () => void;
}

export function TasksTopbar({
  route,
  projects,
  sidebarCollapsed,
  pagerScope,
  onNavigate,
  onToggleSidebar,
  onNewTask,
  onBack,
}: TasksTopbarProps) {
  const project = useMemo(() => {
    if (route.kind === "project") {
      return (projects ?? []).find((p) => p.id === route.projectId) ?? null;
    }
    if (route.kind === "task") {
      // Task keys are `<prefix>-<number>`, so the prefix resolves the project.
      const prefix = route.taskKey.split("-", 1)[0] ?? "";
      return (projects ?? []).find((p) => p.prefix === prefix) ?? null;
    }
    return null;
  }, [route, projects]);

  const breadcrumb = (() => {
    switch (route.kind) {
      case "all":
        return <span className="font-semibold">All tasks</span>;
      case "active":
        return (
          <span className="flex items-center gap-2">
            <span className="font-semibold">Active</span>
            <span className="text-xs font-normal text-muted-foreground">
              agents working now
            </span>
          </span>
        );
      case "manage":
        return (
          <span className="flex items-center gap-2">
            <span className="font-semibold">Manage</span>
            <span className="text-xs font-normal text-muted-foreground">
              labels, presets, folders
            </span>
          </span>
        );
      case "project":
        return (
          <span className="flex min-w-0 items-center gap-2">
            {project ? (
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: project.color }}
              />
            ) : null}
            <span className="truncate font-semibold">
              {project?.name ?? "Project"}
            </span>
          </span>
        );
      case "task":
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label="Back (Esc)"
              onClick={onBack}
            >
              <Icon name="ChevronLeft" className="size-4" />
            </Button>
            {project ? (
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  onNavigate({
                    kind: "project",
                    projectId: project.id,
                    view: "list",
                  })
                }
              >
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate font-medium">{project.name}</span>
              </button>
            ) : null}
            {project ? (
              <Icon
                name="ChevronRight"
                className="size-3 shrink-0 text-muted-foreground"
              />
            ) : null}
            <span className="shrink-0 font-medium text-muted-foreground">
              {route.taskKey}
            </span>
          </span>
        );
    }
  })();

  return (
    <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border-hairline bg-background px-3.5 text-sm">
      <div className="min-w-0 flex-1">{breadcrumb}</div>
      {route.kind === "task" && (pagerScope !== null || projects !== undefined) ? (
        <TaskPager
          taskKey={route.taskKey}
          // No browse context (deep link): step through the task's own
          // project in list order; All tasks only if its project is unknown.
          projectId={pagerScope !== null ? pagerScope.projectId : (project?.id ?? null)}
          onNavigate={onNavigate}
        />
      ) : null}
      {route.kind === "project" ? (
        <ViewToggle
          view={route.view}
          onChange={(view) => onNavigate({ ...route, view })}
        />
      ) : null}
      {route.kind !== "task" && route.kind !== "manage" ? (
        <Button size="sm" className="h-7 gap-1.5" onClick={onNewTask}>
          <Icon name="Plus" className="size-3.5" />
          New task
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!sidebarCollapsed}
        onClick={onToggleSidebar}
      >
        <Icon name="PanelRight" className="size-4" />
      </Button>
    </header>
  );
}
