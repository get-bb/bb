import { useCallback, useMemo } from "react";
import type { Project, Task } from "../shared/contract.js";
import { groupTasksByStatus } from "../views/list/lib.js";
import { listAllTasks, useTasksQuery } from "./data.js";
import type {
  ResolvedTasksRoute,
  TaskViewMode,
  TasksRoute,
} from "./routes.js";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { useTasksRefresh } from "./refresh.js";

/** Accessible name + tooltip for the header refresh control. */
export const REFRESH_TASKS_LABEL = "Refresh tasks";

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
      listAllTasks(rpc, {
        ...(projectId === null ? {} : { projectId }),
        parentTaskId: null,
      }),
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
    // The pager yields entirely below @sm so the task key — the row's
    // identity — keeps the width; the in-page task content carries its own
    // navigation on the smallest phones.
    <div className="hidden shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground @sm:flex">
      {/* The position readout yields to the task key in narrow containers;
          the step buttons remain. */}
      <span className="hidden px-1 @md:inline">
        {position.index} / {position.total}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 max-md:pointer-coarse:size-9"
        aria-label="Previous task"
        disabled={position.prevKey === null}
        onClick={() => step(position.prevKey)}
      >
        <Icon name="ChevronUp" className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 max-md:pointer-coarse:size-9"
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
        "rounded-sm px-2.5 py-0.5 text-xs max-md:pointer-coarse:py-1.5",
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

/**
 * Subtle icon-only refresh control. Shares the BB-19 generation channel; does
 * not add listeners or alternate refresh paths. In-flight state tracks real
 * generation-driven query work (spin + disabled) with fixed geometry so the
 * header does not shift.
 */
function RefreshTasksButton() {
  const { refresh, isRefreshing } = useTasksRefresh();

  const handleRefresh = useCallback(() => {
    if (isRefreshing) return;
    refresh();
  }, [isRefreshing, refresh]);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground active:bg-state-active active:text-foreground max-md:pointer-coarse:size-9"
            aria-label={REFRESH_TASKS_LABEL}
            aria-busy={isRefreshing}
            disabled={isRefreshing}
            onClick={handleRefresh}
          >
            <Icon
              name="RotateCcw"
              className={cn("size-3.5", isRefreshing && "animate-spin")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{REFRESH_TASKS_LABEL}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface TasksTopbarProps {
  route: ResolvedTasksRoute;
  projects: Project[] | undefined;
  /**
   * Pager scope on task routes: the list/board browsed before (projectId null
   * = All tasks). null when no list/board was visited this session (deep
   * link) — the pager then anchors to the task's own project.
   */
  pagerScope: { projectId: string | null } | null;
  onNavigate: (route: TasksRoute) => void;
  onNewTask: () => void;
  onBack: () => void;
}

export function TasksTopbar({
  route,
  projects,
  pagerScope,
  onNavigate,
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
        return (
          <span className="whitespace-nowrap font-semibold">All tasks</span>
        );
      case "active":
        return (
          <span className="flex items-center gap-2">
            <span className="whitespace-nowrap font-semibold">Active</span>
            <span className="hidden text-xs font-normal text-muted-foreground @md:inline">
              agents working now
            </span>
          </span>
        );
      case "manage":
        return (
          <span className="flex items-center gap-2">
            <span className="whitespace-nowrap font-semibold">Manage</span>
            <span className="hidden text-xs font-normal text-muted-foreground @md:inline">
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
              className="size-6 shrink-0 max-md:pointer-coarse:size-9"
              aria-label="Back (Esc)"
              onClick={onBack}
            >
              <Icon name="ChevronLeft" className="size-4" />
            </Button>
            {/* In narrow containers the project crumb yields the row to the
                task key — the back button already returns to the project. */}
            {project ? (
              <button
                type="button"
                className="hidden min-w-0 items-center gap-2 text-muted-foreground hover:text-foreground @md:flex"
                onClick={() =>
                  // No explicit view: the shell restores the project's
                  // remembered List/Board choice.
                  onNavigate({
                    kind: "project",
                    projectId: project.id,
                    view: null,
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
                className="hidden size-3 shrink-0 text-muted-foreground @md:block"
              />
            ) : null}
            <span className="min-w-0 truncate font-medium text-muted-foreground">
              {route.taskKey}
            </span>
          </span>
        );
    }
  })();

  return (
    // On compact viewports the host renders no pane header above this bar, so
    // the host's fixed sidebar toggle (pinned at the window's top-left, see the
    // app's SidebarTriggerOverlay) shares this row. Reserve its footprint as
    // left padding — 12px inset + 28px trigger + 8px gap (36px touch trigger on
    // coarse pointers) — and match the 48px chrome-row height so the toggle and
    // this bar's controls sit on one axis. The reserve keys off the viewport
    // (`max-md:`), not the container, because the toggle is viewport-fixed and
    // wide windows always place a host pane header above this bar instead.
    <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border-hairline bg-background px-3.5 text-sm max-md:h-12 max-md:pl-12 max-md:pointer-coarse:pl-14">
      <div className="min-w-0 flex-1 overflow-hidden">{breadcrumb}</div>
      {route.kind === "task" &&
      (pagerScope !== null || projects !== undefined) ? (
        <TaskPager
          taskKey={route.taskKey}
          // No browse context (deep link): step through the task's own
          // project in list order; All tasks only if its project is unknown.
          projectId={
            pagerScope !== null ? pagerScope.projectId : (project?.id ?? null)
          }
          onNavigate={onNavigate}
        />
      ) : null}
      {route.kind === "project" ? (
        // Hidden in phone-width containers, where the board is unusable and
        // the shell renders the list regardless (see BOARD_MIN_WIDTH).
        <span className="hidden @md:block">
          <ViewToggle
            view={route.view}
            onChange={(view) => onNavigate({ ...route, view })}
          />
        </span>
      ) : null}
      {/* Refresh sits immediately left of the primary New task action. */}
      <RefreshTasksButton />
      {route.kind !== "task" && route.kind !== "manage" ? (
        <Button
          size="sm"
          className="h-7 gap-1.5 max-md:pointer-coarse:h-9"
          aria-label="New task"
          onClick={onNewTask}
        >
          <Icon name="Plus" className="size-3.5" />
          {/* Icon-only in narrow containers so the breadcrumb (project name,
              view toggle) keeps readable width. */}
          <span className="hidden @lg:inline">New task</span>
        </Button>
      ) : null}
    </header>
  );
}
