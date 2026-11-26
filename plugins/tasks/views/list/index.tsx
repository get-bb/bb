import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Label, Task } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import { useProjects, useTasksRpc } from "../../shell/data.js";
import { useTasksNavigation } from "../../shell/routes.js";
import { NewTaskDialog } from "../manage/new-task-dialog.js";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";
import { EmptyState } from "../../components/empty-state.js";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useLabels,
  useListTaskEdit,
  useListTasks,
  widestKeysByPrefix,
  useTaskListMeta,
  type TaskEdit,
} from "./data.js";
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
  childrenByParent,
  childrenForList,
  displayRows,
  groupTasksByStatus,
  labelFilterOptions,
  parentIsOpen,
  selectedLabelIds,
  STATUS_LABELS,
  taskMatches,
  listTaskCount,
  type TaskMatchCriteria,
} from "./lib.js";
import { KeyColumnScope, TaskRow } from "./row.js";
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
  const rpc = useTasksRpc();
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
  const expanded = preference.expandedTaskIds;
  const updatePreference = useCallback(
    (update: (current: ListPreference) => ListPreference) => {
      setPreference((current) => {
        const updated = update(current);
        storeListPreference(preferenceScope, updated);
        return updated;
      });
    },
    [preferenceScope],
  );
  const setFilters = (next: ListFilterState) =>
    updatePreference((current) => ({ ...current, filters: next }));
  const setSort = (next: TaskSort) =>
    updatePreference((current) => ({ ...current, sort: next }));
  const toggleSubTasks = useCallback(
    (taskId: string) =>
      updatePreference((current) => ({
        ...current,
        expandedTaskIds: current.expandedTaskIds.includes(taskId)
          ? current.expandedTaskIds.filter((id) => id !== taskId)
          : [...current.expandedTaskIds, taskId],
      })),
    [updatePreference],
  );
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [search, setSearch] = useState("");

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

  const tasksQuery = useListTasks(projectId, activeOnly);
  const topLevelTasks = useMemo(
    () => tasksQuery.data?.filter((task) => task.parentTaskId === null),
    [tasksQuery.data],
  );
  const allChildrenByParent = useMemo(
    () => childrenByParent(tasksQuery.data ?? []),
    [tasksQuery.data],
  );
  const meta = useTaskListMeta(projectId);
  const taskEdit = useListTaskEdit(tasksQuery.reads);
  const { mutate: mutateTask } = taskEdit;
  const refreshTasks = tasksQuery.refresh;
  const editTask = useCallback(
    (task: Task, patch: TaskEdit) => {
      mutateTask({ taskId: task.id, ...patch }).then(
        (result) => {
          if (result.ok) return;
          push(result.error.message);
          refreshTasks();
        },
        (error: unknown) => push(errorMessage(error)),
      );
    },
    [mutateTask, push, refreshTasks],
  );
  const pendingTaskIds = useMemo(
    () => new Set(taskEdit.pendingInputs.map((input) => input.taskId)),
    [taskEdit.pendingInputs],
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
  const moveToProject = useCallback(
    (task: Task, targetProjectId: string) => {
      rpc
        .call("moveTaskToProject", {
          taskId: task.id,
          projectId: targetProjectId,
        })
        .then(
          (result) => {
            if (!result.ok) push(result.error.message);
          },
          (error: unknown) => push(errorMessage(error)),
        );
    },
    [rpc, push],
  );
  const projectsById = useMemo(
    () =>
      new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );

  const activeIds = tasksQuery.activeIds;
  const matchCriteria = useMemo(
    (): TaskMatchCriteria => ({
      statuses: filters.statuses,
      priorities: filters.priorities,
      labelIds,
      search,
      activeIds,
    }),
    [filters.statuses, filters.priorities, labelIds, search, activeIds],
  );
  const { visible: visibleChildren, totals: childTotals } = useMemo(
    () => childrenForList(allChildrenByParent, matchCriteria, sort),
    [allChildrenByParent, matchCriteria, sort],
  );
  const displayTasks = useMemo(
    () =>
      topLevelTasks === undefined
        ? undefined
        : displayRows(topLevelTasks, matchCriteria, visibleChildren),
    [topLevelTasks, matchCriteria, visibleChildren],
  );
  const taskCount = useMemo(
    () =>
      displayTasks === undefined
        ? undefined
        : listTaskCount(displayTasks, matchCriteria, visibleChildren),
    [displayTasks, matchCriteria, visibleChildren],
  );
  const widestKeys = useMemo(
    () => widestKeysByPrefix(tasksQuery.data ?? []),
    [tasksQuery.data],
  );
  const groups = useMemo(
    () =>
      groupTasksByStatus(sortTasks(displayTasks ?? [], sort)).map((group) => {
        let windowCount = group.tasks.length;
        for (const task of group.tasks) {
          if (!parentIsOpen(task.id, expanded, matchCriteria, visibleChildren))
            continue;
          windowCount += visibleChildren.get(task.id)?.length ?? 0;
        }
        return { ...group, count: group.tasks.length, windowCount };
      }),
    [displayTasks, sort, expanded, matchCriteria, visibleChildren],
  );

  const showProject = projectId === null;
  const filtered = hasActiveFilters(filters) || search.trim() !== "";

  const scrollRef = useRef<HTMLDivElement>(null);
  const scopeKey = listScrollScopeKey({
    projectId,
    activeOnly,
    filters,
    search,
    sort,
  });
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
    counts: groups.map((group) => group.windowCount),
    headerHeight: viewport.headerHeight,
    rowHeight: viewport.rowHeight,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
  });

  let body: ReactNode;
  if (displayTasks === undefined) {
    body =
      tasksQuery.error !== null ? (
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
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setSearch("");
              }}
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
    const rowProps = (task: Task) => ({
      task,
      meta: meta.data?.get(task.id),
      project: projectsById.get(task.projectId),
      showProject,
      labelsById,
      projectLabels: labelsByProject.get(task.projectId) ?? NO_LABELS,
      projects: projects.data ?? [],
      onMoveToProject: moveToProject,
      onEdit: editTask,
      onOpen: openTask,
      pending: pendingTaskIds.has(task.id),
      muted: !taskMatches(task, matchCriteria),
    });
    body = groups.map((group, groupIndex) => {
      const [start, end] = ranges[groupIndex] ?? [0, group.windowCount];
      const hiddenAbove = start * viewport.rowHeight;
      const hiddenBelow = (group.windowCount - end) * viewport.rowHeight;
      const rows: ReactNode[] = [];
      let index = 0;
      for (const task of group.tasks) {
        const open = parentIsOpen(
          task.id,
          expanded,
          matchCriteria,
          visibleChildren,
        );
        if (index >= start && index < end) {
          rows.push(
            <TaskRow
              key={task.id}
              {...rowProps(task)}
              subTasks={childTotals.get(task.id)}
              subTasksOpen={open}
              subTasksLocked={open && !expanded.includes(task.id)}
              onToggleSubTasks={toggleSubTasks}
            />,
          );
        }
        index += 1;
        if (!open) continue;
        for (const child of visibleChildren.get(task.id) ?? []) {
          if (index >= start && index < end) {
            rows.push(<TaskRow key={child.id} {...rowProps(child)} child />);
          }
          index += 1;
        }
      }
      return (
        <section key={group.status}>
          <div
            data-status-group-header={group.status}
            className="sticky top-0 z-20 isolate flex items-center gap-2 border-b border-border-hairline bg-background px-3.5 pb-1.5 pt-2.5 text-sm font-semibold"
          >
            <StatusIcon status={group.status} />
            {STATUS_LABELS[group.status]}
            <span className="text-xs font-normal tabular-nums text-subtle-foreground">
              {group.count}
            </span>
          </div>
          {hiddenAbove > 0 ? (
            <div aria-hidden style={{ height: hiddenAbove }} />
          ) : null}
          {rows}
          {hiddenBelow > 0 ? (
            <div aria-hidden style={{ height: hiddenBelow }} />
          ) : null}
        </section>
      );
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListFilterBar
        filters={filters}
        onChange={setFilters}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        labelOptions={labelOptions}
        taskCount={taskCount}
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <KeyColumnScope
          keys={widestKeys}
          className="@container flex min-h-full flex-col"
        >
          {body}
        </KeyColumnScope>
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
