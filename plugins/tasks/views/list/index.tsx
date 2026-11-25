import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import type { Label, Task } from "../../shared/contract.js";
import { errorMessage } from "../../shared/errors.js";
import {
  selectTasks,
  useProjects,
  useTasksQuery,
  useTasksRpc,
} from "../../shell/data.js";
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
  useTaskListTiming,
  type PendingThread,
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
  activeTopRows,
  childrenByParent,
  childrenForList,
  displayRows,
  groupTasksByStatus,
  labelFilterOptions,
  listCounts,
  parentIsOpen,
  selectedLabelIds,
  STATUS_LABELS,
  taskMatches,
  type TaskMatchCriteria,
} from "./lib.js";
import { KeyColumnScope, SubTaskRow, TaskRow } from "./row.js";
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
  const childInput = useMemo(
    () => (projectId === null ? {} : { projectId }),
    [projectId],
  );
  const childrenQuery = useTasksQuery("listAllTasks", childInput, selectTasks);
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem("bb-tasks:collapsed-subtasks") ?? "[]",
      );
      return Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [];
    } catch {
      return [];
    }
  });
  const allChildrenByParent = useMemo(
    () => childrenByParent(childrenQuery.data ?? []),
    [childrenQuery.data],
  );
  const toggleChildren = (id: string) => {
    setCollapsed((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      try {
        localStorage.setItem(
          "bb-tasks:collapsed-subtasks",
          JSON.stringify(next),
        );
      } catch {}
      return next;
    });
  };
  const meta = useTaskListMeta(projectId);
  const timing = useTaskListTiming(projectId);
  const sidebarThreads = experimental_useSidebarThreads();
  const pendingThreadById = useMemo(() => {
    const map = new Map<string, number>();
    for (const thread of sidebarThreads.threads) {
      if (thread.hasPendingInteraction) {
        map.set(thread.id, thread.latestAttentionAt);
      }
    }
    return map;
  }, [sidebarThreads.threads]);
  const [pendingThreadsByTask, setPendingThreadsByTask] = useState<
    ReadonlyMap<string, readonly PendingThread[]>
  >(() => new Map());
  const handlePendingThreads = useCallback(
    (taskId: string, pending: readonly PendingThread[] | undefined) => {
      const value =
        pending !== undefined && pending.length > 0 ? pending : undefined;
      setPendingThreadsByTask((current) => {
        if (current.get(taskId) === value) return current;
        const next = new Map(current);
        if (value === undefined) next.delete(taskId);
        else next.set(taskId, value);
        return next;
      });
    },
    [],
  );
  const rolledUpPendingThreads = (task: Task) => {
    if (parentIsOpen(task.id, collapsed, matchCriteria, visibleChildren))
      return undefined;
    const children = visibleChildren.get(task.id);
    if (children === undefined) return undefined;
    const pending: PendingThread[] = [];
    for (const child of children) {
      pending.push(...(pendingThreadsByTask.get(child.id) ?? []));
    }
    if (pending.length === 0) return undefined;
    pending.sort((a, b) => a.attentionAt - b.attentionAt);
    return pending;
  };
  const taskEdit = useListTaskEdit([...tasksQuery.reads, childInput]);
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

  const activeIds = useMemo(
    (): ReadonlySet<string> | null =>
      activeOnly
        ? new Set((tasksQuery.data ?? []).map((task) => task.id))
        : null,
    [activeOnly, tasksQuery.data],
  );
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
  const displayTasks = useMemo(() => {
    if (tasksQuery.data === undefined) return undefined;
    if (activeOnly && childrenQuery.data === undefined) return undefined;
    const rows = activeOnly
      ? activeTopRows(tasksQuery.data, childrenQuery.data ?? [])
      : tasksQuery.data;
    return displayRows(rows, matchCriteria, allChildrenByParent);
  }, [
    tasksQuery.data,
    childrenQuery.data,
    activeOnly,
    matchCriteria,
    allChildrenByParent,
  ]);
  const counts = useMemo(
    () =>
      displayTasks === undefined
        ? undefined
        : listCounts(displayTasks, matchCriteria, visibleChildren, activeOnly),
    [displayTasks, matchCriteria, visibleChildren, activeOnly],
  );
  const taskCount = counts?.tasks;
  const subTaskCount = counts?.subTasks;
  const widestKeys = useMemo(
    () => widestKeysByPrefix(tasksQuery.data ?? []),
    [tasksQuery.data],
  );
  const groups = useMemo(
    () =>
      groupTasksByStatus(sortTasks(displayTasks ?? [], sort)).map((group) => {
        let windowCount = group.tasks.length;
        for (const task of group.tasks) {
          if (!parentIsOpen(task.id, collapsed, matchCriteria, visibleChildren))
            continue;
          windowCount += visibleChildren.get(task.id)?.length ?? 0;
        }
        return { ...group, count: group.tasks.length, windowCount };
      }),
    [displayTasks, sort, collapsed, matchCriteria, visibleChildren],
  );

  const showProject = projectId === null;
  const filtered = hasActiveFilters(filters) || search.trim() !== "";
  const loadError = activeOnly
    ? (tasksQuery.error ?? childrenQuery.error)
    : tasksQuery.error;

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
  if (tasksQuery.data === undefined || displayTasks === undefined) {
    body =
      loadError !== null ? (
        <EmptyState
          icon="AlertCircle"
          title="Couldn't load tasks"
          description={loadError}
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
      timing: timing.get(task.id),
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
      pendingThreadById,
      rolledUpPendingThreads: rolledUpPendingThreads(task),
      onPendingThreads: handlePendingThreads,
    });
    body = groups.map((group, groupIndex) => {
      const [start, end] = ranges[groupIndex] ?? [0, group.windowCount];
      const hiddenAbove = start * viewport.rowHeight;
      const hiddenBelow = (group.windowCount - end) * viewport.rowHeight;
      const rows: ReactNode[] = [];
      let index = 0;
      for (const task of group.tasks) {
        const parentVisible = index >= start && index < end;
        const children = visibleChildren.get(task.id);
        const totals = childTotals.get(task.id);
        const open = parentIsOpen(
          task.id,
          collapsed,
          matchCriteria,
          visibleChildren,
        );
        index += 1;
        if (parentVisible) {
          rows.push(
            <TaskRow
              key={task.id}
              {...rowProps(task)}
              subTasks={
                totals !== undefined
                  ? {
                      ...totals,
                      open,
                      disabled: open && collapsed.includes(task.id),
                      toggle: () => toggleChildren(task.id),
                    }
                  : undefined
              }
            />,
          );
        }
        for (const child of children ?? []) {
          if (open) {
            const childVisible = index >= start && index < end;
            index += 1;
            if (!childVisible) continue;
            rows.push(<SubTaskRow key={child.id} open {...rowProps(child)} />);
          } else if (parentVisible) {
            rows.push(
              <SubTaskRow key={child.id} open={false} {...rowProps(child)} />,
            );
          }
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
        subTaskCount={activeOnly ? 0 : subTaskCount}
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
