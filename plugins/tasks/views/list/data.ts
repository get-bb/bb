import { useCallback, useMemo } from "react";
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

export function widestKeysByPrefix(tasks: readonly Task[]): string[] {
  const widest = new Map<string, string>();
  for (const task of tasks) {
    const prefix = task.key.slice(0, task.key.lastIndexOf("-"));
    const current = widest.get(prefix);
    if (current === undefined || task.key.length > current.length) {
      widest.set(prefix, task.key);
    }
  }
  return [...widest.values()];
}

const NO_TASKS: readonly Task[] = [];

function mergeById(...lists: readonly (readonly Task[] | undefined)[]) {
  const byId = new Map<string, Task>();
  for (const list of lists) {
    for (const task of list ?? []) byId.set(task.id, task);
  }
  return [...byId.values()];
}

export function useListTasks(projectId: string | null, activeOnly: boolean) {
  const scope = projectId === null ? {} : { projectId };
  const openInput = { ...scope, statuses: [...OPEN_TASK_STATUSES] };
  const closedInput = { ...scope, statuses: [...CLOSED_TASK_STATUSES] };
  const open = useTasksQuery("listAllTasks", openInput, selectTasks);
  const closed = useTasksQuery("listAllTasks", closedInput, selectTasks);
  const activeInput = { ...scope, activeOnly: true };
  const active = useTasksQuery("listAllTasks", activeInput, selectTasks, {
    enabled: activeOnly,
  });
  const activeTasks = activeOnly ? active.data : NO_TASKS;
  const data = useMemo(
    () =>
      open.data === undefined || activeTasks === undefined
        ? undefined
        : mergeById(open.data, closed.data, activeTasks),
    [open.data, closed.data, activeTasks],
  );
  const activeIds = useMemo(
    (): ReadonlySet<string> | null =>
      activeOnly ? new Set((activeTasks ?? []).map((task) => task.id)) : null,
    [activeOnly, activeTasks],
  );
  const { refresh: refreshOpen } = open;
  const { refresh: refreshClosed } = closed;
  const { refresh: refreshActive } = active;
  const refresh = useCallback(() => {
    refreshOpen();
    refreshClosed();
    if (activeOnly) refreshActive();
  }, [refreshOpen, refreshClosed, refreshActive, activeOnly]);
  return {
    data,
    activeIds,
    error: open.error ?? closed.error ?? (activeOnly ? active.error : null),
    isLoading:
      open.isLoading || closed.isLoading || (activeOnly && active.isLoading),
    reads: activeOnly
      ? [openInput, closedInput, activeInput]
      : [openInput, closedInput],
    refresh,
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
