import {
  listAllTasks,
  listTasksOpenFirst,
  patchTasks,
  signalTaskIds,
  useTasksQuery,
  useTasksRead,
  type TaskSignal,
  type TasksRpc,
} from "../../shell/data.js";
import type {
  Task,
  TaskPriority,
  TaskStatus,
  TaskThread,
} from "../../shared/contract.js";
import { isActiveThread } from "../detail/meta.js";

interface ListTaskFilters {
  statuses: readonly TaskStatus[];
  priorities: readonly TaskPriority[];
  labelIds: readonly string[] | null;
}

function belongsToList(
  task: Task,
  projectId: string | null,
  filters: ListTaskFilters,
): boolean {
  if (task.parentTaskId !== null) return false;
  if (projectId !== null && task.projectId !== projectId) return false;
  if (filters.statuses.length > 0 && !filters.statuses.includes(task.status)) {
    return false;
  }
  if (
    filters.priorities.length > 0 &&
    !filters.priorities.includes(task.priority)
  ) {
    return false;
  }
  if (filters.labelIds !== null) {
    const wanted = new Set(filters.labelIds);
    if (!task.labelIds.some((labelId) => wanted.has(labelId))) return false;
  }
  return true;
}

export function useListTasks(
  projectId: string | null,
  activeOnly: boolean,
  filters: ListTaskFilters,
) {
  const query = {
    ...(projectId === null ? {} : { projectId }),
    ...(filters.priorities.length > 0
      ? { priorities: [...filters.priorities] }
      : {}),
    ...(filters.labelIds !== null ? { labelIds: [...filters.labelIds] } : {}),
    activeOnly,
    parentTaskId: null,
  };
  return useTasksQuery<Task[]>(
    async (rpc, publish) =>
      filters.statuses.length > 0 || activeOnly
        ? listAllTasks(rpc, {
            ...query,
            ...(filters.statuses.length > 0
              ? { statuses: [...filters.statuses] }
              : {}),
          })
        : listTasksOpenFirst(rpc, query, publish),
    activeOnly ? ["tasks:changed", "threads:changed"] : ["tasks:changed"],
    [
      projectId,
      activeOnly,
      filters.statuses.join(),
      filters.priorities.join(),
      filters.labelIds === null ? "" : `active:${filters.labelIds.join()}`,
    ],
    activeOnly
      ? {}
      : {
          applySignals: (rpc, current, signals) =>
            patchTasks(
              rpc,
              current,
              signalTaskIds(signals, "tasks:changed"),
              (task) => belongsToList(task, projectId, filters),
            ),
        },
  );
}

export function useLabels(projectIds: readonly string[]) {
  const query = useTasksRead(
    "listLabelsForProjects",
    { projectIds: [...projectIds] },
    (result) => result.labels,
    ["projects:changed"],
    { enabled: projectIds.length > 0 },
  );
  return { ...query, data: projectIds.length === 0 ? [] : query.data };
}

export interface TaskRowMeta {
  activeThreads: TaskThread[];
}

async function activeThreadsFor(
  rpc: TasksRpc,
  taskId: string,
): Promise<TaskThread[]> {
  const { taskThreads } = await rpc.call("listTaskThreads", { taskId });
  return taskThreads.filter(isActiveThread);
}

async function patchListMeta(
  rpc: TasksRpc,
  current: ReadonlyMap<string, TaskRowMeta>,
  signals: readonly TaskSignal[],
): Promise<Map<string, TaskRowMeta>> {
  const taskIds = new Set([
    ...signalTaskIds(signals, "threads:changed"),
    ...signalTaskIds(signals, "tasks:changed"),
  ]);
  const next = new Map(current);
  await Promise.all(
    [...taskIds].map(async (taskId) => {
      const activeThreads = await activeThreadsFor(rpc, taskId);
      if (activeThreads.length > 0) next.set(taskId, { activeThreads });
      else next.delete(taskId);
    }),
  );
  return next;
}

export function useTaskListMeta(projectId: string | null) {
  return useTasksQuery<Map<string, TaskRowMeta>>(
    async (rpc) => {
      const activeTasks = await listAllTasks(rpc, {
        ...(projectId === null ? {} : { projectId }),
        activeOnly: true,
        parentTaskId: null,
      });
      const entries = await Promise.all(
        activeTasks.map(
          async (task) =>
            [
              task.id,
              { activeThreads: await activeThreadsFor(rpc, task.id) },
            ] as const,
        ),
      );
      return new Map(
        entries.filter(([, meta]) => meta.activeThreads.length > 0),
      );
    },
    ["threads:changed", "tasks:changed"],
    [projectId],
    { applySignals: patchListMeta },
  );
}
