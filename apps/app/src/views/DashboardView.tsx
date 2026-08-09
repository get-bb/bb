import { type CSSProperties, useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ThreadListEntry } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useUpdateThread } from "@/hooks/mutations/thread-state-mutations";
import { formatRelativeTime } from "@/lib/relative-time";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath, isProjectlessProjectId } from "@/lib/route-paths";

export type DashboardThreadColumnId =
  | "backlog"
  | "in-progress"
  | "in-review"
  | "done"
  | "canceled";

const DASHBOARD_COLUMN_DROP_PREFIX = "dashboard-column:";

const dashboardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

interface DashboardColumn {
  id: DashboardThreadColumnId;
  label: string;
  indicatorClassName: string;
  indicatorKind?: "cancel";
  emptyMessage: string;
}

export const DASHBOARD_COLUMNS: readonly DashboardColumn[] = [
  {
    id: "backlog",
    label: "Backlog",
    indicatorClassName: "bg-kanban-backlog",
    emptyMessage: "No backlog threads",
  },
  {
    id: "in-progress",
    label: "In progress",
    indicatorClassName: "bg-kanban-in-progress",
    emptyMessage: "No active work",
  },
  {
    id: "in-review",
    label: "In review",
    indicatorClassName: "bg-kanban-in-review",
    emptyMessage: "No threads in review",
  },
  {
    id: "done",
    label: "Done",
    indicatorClassName: "bg-kanban-done",
    emptyMessage: "No completed threads",
  },
  {
    id: "canceled",
    label: "Canceled",
    indicatorClassName: "text-kanban-canceled",
    indicatorKind: "cancel",
    emptyMessage: "No canceled threads",
  },
];

export function getDashboardThreadColumn(
  thread: Pick<ThreadListEntry, "dashboardStatus">,
): DashboardThreadColumnId {
  return thread.dashboardStatus;
}

export function groupDashboardThreads(
  threads: readonly ThreadListEntry[],
): Readonly<Record<DashboardThreadColumnId, readonly ThreadListEntry[]>> {
  const grouped: Record<DashboardThreadColumnId, ThreadListEntry[]> = {
    backlog: [],
    "in-progress": [],
    "in-review": [],
    done: [],
    canceled: [],
  };

  for (const thread of threads) {
    grouped[getDashboardThreadColumn(thread)].push(thread);
  }

  return grouped;
}

function getDashboardThreads(
  navigation: ReturnType<typeof useSidebarNavigation>["data"],
): ThreadListEntry[] {
  if (!navigation) return [];
  return [
    ...navigation.personalProject.threads,
    ...navigation.projects.flatMap((project) => project.threads),
  ].filter((thread) => thread.archivedAt === null && thread.deletedAt === null);
}

function getProjectName(
  thread: ThreadListEntry,
  projectNamesById: ReadonlyMap<string, string>,
): string {
  if (isProjectlessProjectId(thread.projectId)) {
    return projectNamesById.get(thread.projectId) ?? "Personal";
  }
  return projectNamesById.get(thread.projectId) ?? thread.projectId;
}

function getDashboardColumnDropId(columnId: DashboardThreadColumnId): string {
  return `${DASHBOARD_COLUMN_DROP_PREFIX}${columnId}`;
}

function getDashboardColumnIdFromDropId(
  dropId: string | null,
): DashboardThreadColumnId | null {
  if (!dropId?.startsWith(DASHBOARD_COLUMN_DROP_PREFIX)) {
    return null;
  }
  const columnId = dropId.slice(DASHBOARD_COLUMN_DROP_PREFIX.length);
  return DASHBOARD_COLUMNS.find((column) => column.id === columnId)?.id ?? null;
}

interface DashboardThreadCardProps {
  projectName: string;
  thread: ThreadListEntry;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  dragRef?: (element: HTMLElement | null) => void;
  style?: CSSProperties;
  isDragging?: boolean;
  isDragOverlay?: boolean;
}

function DashboardThreadCard({
  dragAttributes,
  dragListeners,
  dragRef,
  isDragOverlay = false,
  isDragging = false,
  projectName,
  style,
  thread,
}: DashboardThreadCardProps) {
  const title = getThreadDisplayTitle(thread);
  const columnId = getDashboardThreadColumn(thread);
  const column =
    DASHBOARD_COLUMNS.find((candidate) => candidate.id === columnId) ??
    DASHBOARD_COLUMNS[0];
  const [now] = useState(() => Date.now());

  const cardContent = (
    <>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={projectName}>
          {projectName}
        </span>
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            column.indicatorClassName,
          )}
          role="img"
          aria-label={column.label}
        />
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {title}
      </h3>
      <div className="mt-4 flex min-w-0 items-center gap-3 text-2xs text-muted-foreground">
        {thread.environmentBranchName ? (
          <span className="flex min-w-0 items-center gap-1">
            <Icon
              name="GitBranch"
              className="size-3 shrink-0"
              aria-hidden="true"
            />
            <span className="truncate" title={thread.environmentBranchName}>
              {thread.environmentBranchName}
            </span>
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Icon name="Clock" className="size-3" aria-hidden="true" />
          {formatRelativeTime({ timestamp: thread.updatedAt, now })}
        </span>
      </div>
    </>
  );

  const className = cn(
    "group block rounded-lg border border-border bg-card p-3 shadow-xs transition-[border-color,background-color,box-shadow,opacity,transform] duration-150 ease-out hover:border-primary/40 hover:bg-surface-raised hover:shadow-sm active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    !isDragOverlay && "cursor-grab active:cursor-grabbing",
    isDragging && "opacity-35",
    isDragOverlay &&
      "rotate-[1.5deg] border-primary/45 shadow-xl ring-1 ring-primary/20",
  );

  if (isDragOverlay) {
    return (
      <div className={className} style={style}>
        {cardContent}
      </div>
    );
  }

  return (
    <Link
      ref={dragRef}
      to={getThreadRoutePath({
        projectId: thread.projectId,
        threadId: thread.id,
      })}
      aria-label={`Open ${title}`}
      className={className}
      style={style}
      {...dragAttributes}
      {...dragListeners}
    >
      {cardContent}
    </Link>
  );
}

function DashboardDraggableThreadCard({
  projectNamesById,
  thread,
}: {
  projectNamesById: ReadonlyMap<string, string>;
  thread: ThreadListEntry;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform } =
    useDraggable({ id: thread.id });

  return (
    <DashboardThreadCard
      dragAttributes={attributes}
      dragListeners={listeners}
      dragRef={setNodeRef}
      isDragging={isDragging}
      projectName={getProjectName(thread, projectNamesById)}
      style={{ transform: CSS.Translate.toString(transform) }}
      thread={thread}
    />
  );
}

function DashboardKanbanColumn({
  activeThreadId,
  column,
  projectNamesById,
  threads,
}: {
  activeThreadId: string | null;
  column: DashboardColumn;
  projectNamesById: ReadonlyMap<string, string>;
  threads: readonly ThreadListEntry[];
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: getDashboardColumnDropId(column.id),
  });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "relative flex min-w-0 flex-col rounded-xl bg-surface-recessed/45 p-2.5 transition-[background-color,box-shadow] duration-150 ease-out",
        isOver &&
          activeThreadId !== null &&
          "bg-surface-raised shadow-sm ring-1 ring-inset ring-primary/45",
      )}
      aria-labelledby={`dashboard-column-${column.id}`}
    >
      <header className="flex items-center gap-2 px-1.5 pb-2.5">
        {column.indicatorKind === "cancel" ? (
          <Icon
            name="CircleX"
            className={cn("size-3.5", column.indicatorClassName)}
            aria-hidden="true"
          />
        ) : (
          <span
            className={cn("size-2 rounded-full", column.indicatorClassName)}
          />
        )}
        <h2
          id={`dashboard-column-${column.id}`}
          className="text-xs font-semibold text-foreground"
        >
          {column.label}
        </h2>
        <span className="text-xs text-muted-foreground">{threads.length}</span>
      </header>
      <div
        className={cn(
          "min-h-32 space-y-2 rounded-lg transition-[background-color,box-shadow] duration-150 ease-out",
          isOver &&
            activeThreadId !== null &&
            "bg-surface-recessed/35 shadow-[inset_0_0_0_1px_var(--primary)]",
        )}
      >
        {threads.length > 0 ? (
          threads.map((thread) => (
            <DashboardDraggableThreadCard
              key={thread.id}
              thread={thread}
              projectNamesById={projectNamesById}
            />
          ))
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-1.5 py-6 text-center">
            <p className="text-xs text-muted-foreground/70">
              {column.emptyMessage}
            </p>
          </div>
        )}
      </div>
      {isOver && activeThreadId !== null ? (
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-primary/35 bg-background px-2.5 py-1 text-2xs font-medium text-foreground shadow-xs"
        >
          Move to {column.label}
        </span>
      ) : null}
    </section>
  );
}

function DashboardKanban({
  projectNamesById,
  threads,
}: {
  projectNamesById: ReadonlyMap<string, string>;
  threads: readonly ThreadListEntry[];
}) {
  const groupedThreads = groupDashboardThreads(threads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const updateThread = useUpdateThread({
    errorMessage: "Failed to move thread.",
  });
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const activeThread = activeThreadId
    ? (threads.find((thread) => thread.id === activeThreadId) ?? null)
    : null;

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const threadId = String(event.active.id);
      const destination = getDashboardColumnIdFromDropId(
        event.over ? String(event.over.id) : null,
      );
      const thread = threads.find((candidate) => candidate.id === threadId);
      setActiveThreadId(null);
      if (!thread || !destination || thread.dashboardStatus === destination) {
        return;
      }
      updateThread.mutate({
        id: thread.id,
        dashboardStatus: destination,
      });
    },
    [threads, updateThread],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dashboardCollisionDetection}
      onDragStart={(event) => setActiveThreadId(String(event.active.id))}
      onDragCancel={() => setActiveThreadId(null)}
      onDragEnd={handleDragEnd}
    >
      <div
        data-testid="dashboard-kanban"
        className="min-h-0 min-w-0 flex-1 overflow-x-auto pb-1"
      >
        <div className="grid min-h-full min-w-[80rem] grid-cols-5 gap-3">
          {DASHBOARD_COLUMNS.map((column) => (
            <DashboardKanbanColumn
              key={column.id}
              activeThreadId={activeThreadId}
              column={column}
              projectNamesById={projectNamesById}
              threads={groupedThreads[column.id]}
            />
          ))}
        </div>
      </div>
      {/* dnd-kit can only animate the overlay back to its source node. The
       * optimistic mutation renders the card in its destination column, so
       * remove the source-return animation on drop. */}
      <DragOverlay dropAnimation={null}>
        {activeThread ? (
          <DashboardThreadCard
            isDragOverlay
            projectName={getProjectName(activeThread, projectNamesById)}
            thread={activeThread}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DashboardGridPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-surface-recessed/30 px-6 py-16 text-center">
      <div className="max-w-sm">
        <Icon
          name="GridView"
          className="mx-auto size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="mt-3 text-sm font-medium text-foreground">
          Grid view is next
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The Kanban view is ready now. A compact grid for scanning threads is
          coming soon.
        </p>
      </div>
    </div>
  );
}

export function DashboardView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedView = searchParams.get("view") === "grid" ? "grid" : "kanban";
  const sidebarNavigationQuery = useSidebarNavigation();
  const threads = useMemo(
    () => getDashboardThreads(sidebarNavigationQuery.data),
    [sidebarNavigationQuery.data],
  );
  const projectNamesById = useMemo(() => {
    const names = new Map<string, string>();
    const navigation = sidebarNavigationQuery.data;
    if (!navigation) return names;
    names.set(navigation.personalProject.id, navigation.personalProject.name);
    for (const project of navigation.projects) {
      names.set(project.id, project.name);
    }
    return names;
  }, [sidebarNavigationQuery.data]);

  const selectView = (view: "kanban" | "grid") => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("view", view);
    setSearchParams(nextSearchParams, { replace: true });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            Drag threads between columns to update their workflow state.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Dashboard view"
          className="inline-flex items-center rounded-lg border border-border bg-surface-recessed/50 p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedView === "kanban"}
            aria-controls="dashboard-view-panel"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-150 ease-out active:scale-[0.98]",
              selectedView === "kanban"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
            )}
            onClick={() => selectView("kanban")}
          >
            <Icon name="Columns2" className="size-3.5" aria-hidden="true" />
            Kanban
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedView === "grid"}
            aria-controls="dashboard-view-panel"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-150 ease-out active:scale-[0.98]",
              selectedView === "grid"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
            )}
            onClick={() => selectView("grid")}
          >
            <Icon name="GridView" className="size-3.5" aria-hidden="true" />
            Grid
          </button>
        </div>
      </div>

      <div
        id="dashboard-view-panel"
        role="tabpanel"
        aria-label={selectedView === "kanban" ? "Kanban view" : "Grid view"}
        className="flex min-h-0 flex-1"
      >
        {selectedView === "grid" ? (
          <DashboardGridPlaceholder />
        ) : sidebarNavigationQuery.isLoading ? (
          <div
            role="status"
            className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-surface-recessed/30 px-6 py-16 text-sm text-muted-foreground"
          >
            Loading threads…
          </div>
        ) : sidebarNavigationQuery.isError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface-recessed/30 px-6 py-16 text-center">
            <p className="text-sm text-destructive">Could not load threads.</p>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => void sidebarNavigationQuery.refetch()}
            >
              Try again
            </button>
          </div>
        ) : (
          <DashboardKanban
            threads={threads}
            projectNamesById={projectNamesById}
          />
        )}
      </div>
    </div>
  );
}
