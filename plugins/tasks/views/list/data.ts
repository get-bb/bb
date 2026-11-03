import { useCallback, useMemo, useState } from "react";
import {
  experimental_useRpcKeyedQuery,
  experimental_useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import {
  CLOSED_TASK_STATUSES,
  OPEN_TASK_STATUSES,
  selectCards,
  selectTasks,
  useTasksQuery,
  type TasksInput,
} from "../../shell/data.js";
import {
  tasksRpcContract,
  type Label,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TaskThread,
} from "../../shared/contract.js";

interface ListTaskFilters {
  statuses: readonly TaskStatus[];
  priorities: readonly TaskPriority[];
  labelIds: readonly string[] | null;
}

export interface TaskEdit {
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  labelIds?: string[];
}

export function applyEdit(task: Task, edit: TaskEdit): Task {
  return {
    ...task,
    ...(edit.status !== undefined ? { status: edit.status } : {}),
    ...(edit.priority !== undefined ? { priority: edit.priority } : {}),
    ...(edit.dueDate !== undefined ? { dueDate: edit.dueDate } : {}),
    ...(edit.labelIds !== undefined ? { labelIds: edit.labelIds } : {}),
  };
}

export function matchesFilters(
  task: Task,
  statuses: readonly TaskStatus[],
  priorities: readonly TaskPriority[],
  labelIds: readonly string[],
): boolean {
  return (
    (statuses.length === 0 || statuses.includes(task.status)) &&
    (priorities.length === 0 || priorities.includes(task.priority)) &&
    (labelIds.length === 0 || task.labelIds.some((id) => labelIds.includes(id)))
  );
}

export function listTasksQuery(
  projectId: string | null,
  activeOnly: boolean,
  filters: ListTaskFilters,
): TasksInput<"listAllTasks"> {
  return {
    ...(projectId === null ? {} : { projectId }),
    ...(filters.statuses.length > 0 ? { statuses: [...filters.statuses] } : {}),
    ...(filters.priorities.length > 0
      ? { priorities: [...filters.priorities] }
      : {}),
    ...(filters.labelIds !== null ? { labelIds: [...filters.labelIds] } : {}),
    activeOnly,
    parentTaskId: null,
  };
}

function mergeOpenFirst(open: readonly Task[], closed: readonly Task[]) {
  const byId = new Map<string, Task>();
  for (const task of open) byId.set(task.id, task);
  for (const task of closed) byId.set(task.id, task);
  return [...byId.values()];
}

export function useListTasks(
  projectId: string | null,
  activeOnly: boolean,
  filters: ListTaskFilters,
) {
  const query = listTasksQuery(projectId, activeOnly, filters);
  const single = filters.statuses.length > 0 || activeOnly;
  const openInput = { ...query, statuses: [...OPEN_TASK_STATUSES] };
  const closedInput = { ...query, statuses: [...CLOSED_TASK_STATUSES] };
  const all = useTasksQuery("listAllTasks", query, selectTasks, {
    enabled: single,
  });
  const open = useTasksQuery("listAllTasks", openInput, selectTasks, {
    enabled: !single,
  });
  const closed = useTasksQuery("listAllTasks", closedInput, selectTasks, {
    enabled: !single,
  });
  const merged = useMemo(
    () =>
      open.data === undefined
        ? undefined
        : closed.data === undefined
          ? open.data
          : mergeOpenFirst(open.data, closed.data),
    [open.data, closed.data],
  );
  const current = single ? all.data : merged;
  const isLoading = single ? all.isLoading : open.isLoading || closed.isLoading;
  const [previous, setPrevious] = useState<Task[] | undefined>(undefined);
  if (current !== undefined && current !== previous) setPrevious(current);
  const reads = single ? [query] : [openInput, closedInput];
  const { refresh: refreshOpen } = open;
  const { refresh: refreshClosed } = closed;
  const refreshOpenFirst = useCallback(() => {
    refreshOpen();
    refreshClosed();
  }, [refreshOpen, refreshClosed]);
  return {
    data: current ?? (isLoading ? previous : undefined),
    error: single ? all.error : (open.error ?? closed.error),
    isLoading,
    reads,
    refresh: single ? all.refresh : refreshOpenFirst,
  };
}

export function useListTaskEdit(reads: readonly TasksInput<"listAllTasks">[]) {
  return experimental_useRpcMutation({
    contract: tasksRpcContract,
    method: "updateTask",
    optimistic: ({ taskId, ...edit }, cache) => {
      for (const input of reads) {
        cache.update("listAllTasks", input, (current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId ? applyEdit(task, edit) : task,
          ),
        }));
      }
    },
  });
}

export function useLabels(projectIds: readonly string[]) {
  const query = experimental_useRpcKeyedQuery({
    contract: tasksRpcContract,
    method: "labelsByProject",
    keys: projectIds,
  });
  const loaded = projectIds.every((projectId) =>
    Object.hasOwn(query.data ?? {}, projectId),
  );
  const rows = query.data;
  const data = useMemo(
    (): Label[] | undefined =>
      loaded
        ? projectIds.flatMap((projectId) => rows?.[projectId] ?? [])
        : undefined,
    [loaded, projectIds, rows],
  );
  return { data };
}

export interface TaskRowMeta {
  activeThreads: TaskThread[];
}

export function useTaskListMeta(projectId: string | null) {
  const cards = useTasksQuery(
    "listTaskCardMeta",
    projectId === null ? {} : { projectId },
    selectCards,
  );
  const data = useMemo(
    () =>
      cards.data === undefined
        ? undefined
        : new Map(
            cards.data
              .filter((card) => card.activeThreads.length > 0)
              .map((card) => [
                card.taskId,
                { activeThreads: card.activeThreads },
              ]),
          ),
    [cards.data],
  );
  return { data };
}
