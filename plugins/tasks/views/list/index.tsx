import { useEffect, useMemo, useRef, useState } from "react";
import type { Label } from "../../shared/contract.js";
import { useProjects } from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { NewTaskDialog } from "../manage/index.js";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";
import { Button } from "@bb/shared-ui/button";
import { DelayedLoading } from "../../components/delayed-loading.js";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { useLabels, useListTasks, useTaskListMeta } from "./data.js";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  ListFilterBar,
  type ListFilterState,
} from "./filter-bar.js";
import {
  listPreferenceScope,
  loadListPreference,
  storeListPreference,
  type ListPreference,
} from "./list-preference.js";
import { sortTasks, type TaskSort } from "../../shared/sort.js";
import { StatusIcon } from "./icons.js";
import {
  listScrollScopeKey,
  useListScrollRestoration,
} from "./scroll-restoration.js";
import {
  groupTasksByStatus,
  labelFilterOptions,
  selectedLabelIds,
  STATUS_LABELS,
} from "./lib.js";
import { editedTasks, matchesFilters } from "./optimistic.js";
import { useListTaskEdits } from "./use-task-edits.js";
import { TaskRow } from "./row.js";

export interface ListViewProps {
  /** null renders the cross-project "All tasks" list. */
  projectId: string | null;
  /** Only tasks with agents currently working (the Active route). */
  activeOnly?: boolean;
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Icon name={icon} className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function LoadingRows() {
  return (
    <DelayedLoading>
      <div className="px-3.5 pt-3">
        <Skeleton className="mb-3 h-4 w-28" />
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className="flex h-[34px] items-center gap-2 border-b border-border-hairline"
          >
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        ))}
      </div>
    </DelayedLoading>
  );
}

export function ListView({ projectId, activeOnly = false }: ListViewProps) {
  const navigation = useTasksNavigation();
  const projects = useProjects();
  const { toasts, push, dismiss } = useDetailToasts();
  const preferenceScope = listPreferenceScope(projectId, activeOnly);
  const [preference, setPreference] = useState<ListPreference>(() =>
    loadListPreference(preferenceScope),
  );
  // Remounts already re-read storage; this covers prop-scope changes if the
  // same ListView instance is reused across routes.
  useEffect(() => {
    setPreference(loadListPreference(preferenceScope));
  }, [preferenceScope]);
  const filters = preference.filters;
  const sort = preference.sort;
  const setFilters = (next: ListFilterState) => {
    setPreference((current) => {
      const updated: ListPreference = { filters: next, sort: current.sort };
      storeListPreference(preferenceScope, updated);
      return updated;
    });
  };
  const setSort = (next: TaskSort) => {
    setPreference((current) => {
      const updated: ListPreference = { filters: current.filters, sort: next };
      storeListPreference(preferenceScope, updated);
      return updated;
    });
  };
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const labelProjectIds = useMemo(
    () =>
      projectId !== null
        ? [projectId]
        : (projects.data ?? []).map((project) => project.id),
    [projectId, projects.data],
  );
  const labels = useLabels(labelProjectIds);
  const labelOptions = useMemo(
    () => labelFilterOptions(labels.data ?? []),
    [labels.data],
  );
  // null = no label filter. Once the catalog is loaded, unresolved selected
  // names become an active empty id list so the query matches nothing (not
  // every task). While labels are still loading, defer the filter to avoid a
  // flash of empty results before options arrive.
  const labelIds = useMemo((): readonly string[] | null => {
    if (filters.labelNames.length === 0) return null;
    if (labels.data === undefined) return null;
    return selectedLabelIds(labelOptions, filters.labelNames);
  }, [filters.labelNames, labelOptions, labels.data]);

  const tasksQuery = useListTasks(projectId, activeOnly, {
    statuses: filters.statuses,
    priorities: filters.priorities,
    labelIds,
  });
  const meta = useTaskListMeta(tasksQuery.data);
  const edits = useListTaskEdits(tasksQuery.data, (message) =>
    push("error", message),
  );

  const labelsById = useMemo(
    () => new Map((labels.data ?? []).map((label) => [label.id, label])),
    [labels.data],
  );
  const labelsByProject = useMemo(() => {
    const map = new Map<string, Label[]>();
    for (const label of labels.data ?? []) {
      const bucket = map.get(label.projectId);
      if (bucket) bucket.push(label);
      else map.set(label.projectId, [label]);
    }
    return map;
  }, [labels.data]);
  const projectsById = useMemo(
    () =>
      new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );

  // Optimistic edits are overlaid before sorting/grouping so an edited row jumps
  // to its new status group immediately, and the active status/priority/label
  // filters are re-applied so a row that no longer matches drops out at once
  // instead of waiting for the server refetch.
  const displayTasks = useMemo(() => {
    if (tasksQuery.data === undefined) return undefined;
    return editedTasks(tasksQuery.data, edits.entries).filter((task) =>
      matchesFilters(
        task,
        filters.statuses,
        filters.priorities,
        labelIds ?? [],
      ),
    );
  }, [
    tasksQuery.data,
    edits.entries,
    filters.statuses,
    filters.priorities,
    labelIds,
  ]);
  const groups = useMemo(
    () => groupTasksByStatus(sortTasks(displayTasks ?? [], sort)),
    [displayTasks, sort],
  );

  const showProject = projectId === null;
  const filtered = hasActiveFilters(filters);

  // Remember/restore the list's scroll offset per distinct list+filter+sort
  // context, so opening a task and returning (or refreshing) lands where the
  // user left off. Restore only once the real rows have loaded.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scopeKey = listScrollScopeKey({ projectId, activeOnly, filters, sort });
  // `useListTasks` keeps the previous scope's rows on screen while it refetches
  // and only flips `isLoading` in a later effect, so on the first render after a
  // filter/sort change the rows are stale but `isLoading` is still false. Treat
  // the scope as loading until fresh data for it has settled, giving scroll
  // restoration a synchronously-correct signal that more rows are still coming.
  const settledScope = useRef(scopeKey);
  const scopeChanged = settledScope.current !== scopeKey;
  useEffect(() => {
    if (!tasksQuery.isLoading) settledScope.current = scopeKey;
  }, [scopeKey, tasksQuery.isLoading, tasksQuery.data]);
  // The route scope is the fetch identity across views: All, Active, or one
  // project. Switching it reuses this ListView instance, whose query still
  // holds the previous route's result, so the body below must read as loading
  // until this route's own fetch settles: returning from an empty Active to
  // All must not present Active's emptiness as "No tasks yet". Narrower than
  // `scopeKey` on purpose, so filter and sort changes keep painting the rows
  // they already have. State, not a ref: settling has to rerender the body.
  const routeScope = `${projectId ?? "-"}/${activeOnly}`;
  const [settledRouteScope, setSettledRouteScope] = useState(routeScope);
  const routeScopeChanged = settledRouteScope !== routeScope;
  const previousRouteScope = useRef(routeScope);
  useEffect(() => {
    // The query's own effect flips `isLoading` in this same commit, but this
    // effect still reads the previous render's value, so the commit that
    // changes the route scope must never settle it; a later resolved commit
    // does.
    const routeScopeJustChanged = previousRouteScope.current !== routeScope;
    previousRouteScope.current = routeScope;
    if (!routeScopeJustChanged && !tasksQuery.isLoading) {
      setSettledRouteScope(routeScope);
    }
  }, [routeScope, tasksQuery.isLoading, tasksQuery.data]);
  useListScrollRestoration(scrollRef, scopeKey, {
    contentReady: tasksQuery.data !== undefined && tasksQuery.data.length > 0,
    loading: tasksQuery.isLoading || scopeChanged,
    revision: tasksQuery.data?.length ?? 0,
  });

  let body: React.ReactNode;
  if (
    routeScopeChanged ||
    tasksQuery.data === undefined ||
    displayTasks === undefined
  ) {
    // While a changed route scope is in flight, any held data or error is the
    // previous route's; only a settled result may claim this scope is empty
    // or broken.
    body =
      !routeScopeChanged && tasksQuery.error !== null ? (
        <EmptyState
          icon="AlertCircle"
          title="Couldn't load tasks"
          description={tasksQuery.error}
        />
      ) : (
        <LoadingRows />
      );
  } else if (displayTasks.length === 0) {
    if (filtered) {
      body = (
        <EmptyState
          icon="Search"
          title="No tasks match these filters"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Clear filters
            </Button>
          }
        />
      );
    } else if (activeOnly) {
      body = (
        <EmptyState
          icon="Zap"
          title="No agents working right now"
          description="Dispatch a task to an agent preset and it will show up here while it runs."
        />
      );
    } else {
      body = (
        <EmptyState
          icon="ListTodo"
          title="No tasks yet"
          description="Create the first task to start tracking work."
          action={
            <Button size="sm" onClick={() => setNewTaskOpen(true)}>
              <Icon name="Plus" className="size-3.5" />
              New task
            </Button>
          }
        />
      );
    }
  } else {
    body = groups.map((group) => (
      <section key={group.status}>
        {/*
          Opaque canvas fill + stacking above row chrome: task rows keep
          relative z-10 property editors so they stay clickable above the
          stretched open overlay. The stuck status header must sit higher
          (z-20) with an opaque theme canvas token or those controls and
          titles paint on top while scrolling and read as a transparent bar.
          bg-background maps to --canvas via the host theme (same family as
          card); do not use surface-scrim or hardcoded colors here.
          Hairline bottom border separates the pin band from scrolling rows
          (same token family as the filter bar and row dividers).
        */}
        <div
          data-status-group-header={group.status}
          className="sticky top-0 z-20 isolate flex items-center gap-2 border-b border-border-hairline bg-background px-3.5 pb-1.5 pt-2.5 text-sm font-semibold"
        >
          <StatusIcon status={group.status} />
          {STATUS_LABELS[group.status]}
          <span className="text-xs font-normal tabular-nums text-subtle-foreground">
            {group.tasks.length}
          </span>
        </div>
        {group.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            meta={meta.data?.get(task.id)}
            project={projectsById.get(task.projectId)}
            showProject={showProject}
            labelsById={labelsById}
            projectLabels={labelsByProject.get(task.projectId) ?? []}
            onEdit={edits.edit}
            onOpen={() => navigation.go({ kind: "task", taskKey: task.key })}
            pending={edits.pending.has(task.id)}
          />
        ))}
      </section>
    ));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListFilterBar
        filters={filters}
        onChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        labelOptions={labelOptions}
        taskCount={displayTasks?.length}
      />
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto @container"
      >
        {body}
      </div>
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projectId={projectId}
      />
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
