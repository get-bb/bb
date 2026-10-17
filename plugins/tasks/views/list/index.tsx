import { useTaskMutation, useTaskUpdateMutation } from "../../shell/data.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Label, TaskSummary as Task } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import { useProjects } from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { NewTaskDialog } from "../manage/new-task-dialog.js";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";
import { EmptyState } from "../../components/empty-state.js";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
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
import { sortTasks } from "../../shared/sort.js";
import type { TaskSort } from "../../shared/pagination.js";
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
import { matchesFilters, type TaskEdit } from "../../shared/task-edit.js";
import { TaskRow } from "./row.js";
import { rowWindows, useRowWindowViewport } from "./row-window.js";

const NO_LABELS: readonly Label[] = [];

interface ListViewProps {
  projectId: string | null;
  activeOnly?: boolean;
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
  const moveTaskToProjectMutation = useTaskMutation("moveTaskToProject");
  const openTask = useCallback(
    (taskKey: string) => navigation.go({ kind: "task", taskKey }),
    [navigation],
  );
  const projects = useProjects();
  const { toasts, push, dismiss } = useDetailToasts();
  const preferenceScope = listPreferenceScope(projectId, activeOnly);
  const [preference, setPreference] = useState<ListPreference>(() =>
    loadListPreference(preferenceScope),
  );
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
  const {
    mutate: updateTask,
    isPending: updatingTask,
    pendingInputs,
  } = useTaskUpdateMutation(
    (taskId) => tasksQuery.data?.find((task) => task.id === taskId)?.key,
  );
  const editTask = useCallback(
    (task: Task, patch: TaskEdit) => {
      void updateTask({ taskId: task.id, ...patch }).catch((error: unknown) =>
        push(errorMessage(error)),
      );
    },
    [updateTask, push],
  );
  const meta = useTaskListMeta(projectId);

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
  const moveToProject = useCallback(
    (task: Task, targetProjectId: string) => {
      moveTaskToProjectMutation({
        taskId: task.id,
        projectId: targetProjectId,
      }).catch((error: unknown) => push(errorMessage(error)));
    },
    [moveTaskToProjectMutation, push],
  );
  const projectsById = useMemo(
    () =>
      new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );

  const displayTasks = useMemo(() => {
    if (tasksQuery.data === undefined) return undefined;
    return tasksQuery.data.filter((task) =>
      matchesFilters(
        task,
        filters.statuses,
        filters.priorities,
        labelIds ?? [],
      ),
    );
  }, [tasksQuery.data, filters.statuses, filters.priorities, labelIds]);
  const groups = useMemo(
    () => groupTasksByStatus(sortTasks(displayTasks ?? [], sort)),
    [displayTasks, sort],
  );

  const showProject = projectId === null;
  const filtered = hasActiveFilters(filters);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scopeKey = listScrollScopeKey({ projectId, activeOnly, filters, sort });
  const settledScope = useRef(scopeKey);
  const scopeChanged = settledScope.current !== scopeKey;
  useEffect(() => {
    if (!tasksQuery.isLoading) settledScope.current = scopeKey;
  }, [scopeKey, tasksQuery.isLoading, tasksQuery.data]);
  useListScrollRestoration(scrollRef, scopeKey, {
    contentReady: tasksQuery.data !== undefined && tasksQuery.data.length > 0,
    loading: tasksQuery.isLoading || scopeChanged,
    revision: tasksQuery.data?.length ?? 0,
  });

  const viewport = useRowWindowViewport(scrollRef, groups);
  const ranges = rowWindows({
    counts: groups.map((group) => group.tasks.length),
    headerHeight: viewport.headerHeight,
    rowHeight: viewport.rowHeight,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
  });

  let body: React.ReactNode;
  if (tasksQuery.data === undefined || displayTasks === undefined) {
    body =
      tasksQuery.error !== null ? (
        <EmptyState
          icon="AlertCircle"
          title="Couldn't load tasks"
          description={tasksQuery.error}
          action={
            <Button variant="outline" size="sm" onClick={tasksQuery.refresh}>
              Retry
            </Button>
          }
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
    body = groups.map((group, groupIndex) => {
      const [start, end] = ranges[groupIndex] ?? [0, group.tasks.length];
      const hiddenAbove = start * viewport.rowHeight;
      const hiddenBelow = (group.tasks.length - end) * viewport.rowHeight;
      return (
        <section key={group.status}>
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
          {hiddenAbove > 0 ? (
            <div aria-hidden style={{ height: hiddenAbove }} />
          ) : null}
          {group.tasks.slice(start, end).map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              pending={
                updatingTask &&
                pendingInputs.some((input) => input.taskId === task.id)
              }
              meta={meta.data?.get(task.id)}
              project={projectsById.get(task.projectId)}
              showProject={showProject}
              labelsById={labelsById}
              projectLabels={labelsByProject.get(task.projectId) ?? NO_LABELS}
              projects={projects.data ?? []}
              onMoveToProject={moveToProject}
              onEdit={editTask}
              onOpen={openTask}
            />
          ))}
          {hiddenBelow > 0 ? (
            <div aria-hidden style={{ height: hiddenBelow }} />
          ) : null}
        </section>
      );
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tasksQuery.error && displayTasks !== undefined ? (
        <div
          role="alert"
          className="flex items-center gap-2 p-3 text-sm text-destructive"
        >
          {tasksQuery.error}
          <Button size="sm" variant="outline" onClick={tasksQuery.refresh}>
            Retry
          </Button>
        </div>
      ) : null}
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
        role="region"
        aria-label="Tasks"
        aria-busy={updatingTask || undefined}
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
