import { useMemo } from "react";
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { useTaskRows } from "../../shell/data.js";
import type {
  Label,
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
export function listTasksQuery(
  projectId: string | null,
  activeOnly: boolean,
  filters: ListTaskFilters,
) {
  return {
    ...(projectId === null ? {} : { projectId }),
    ...(filters.statuses.length ? { statuses: [...filters.statuses] } : {}),
    ...(filters.priorities.length
      ? { priorities: [...filters.priorities] }
      : {}),
    ...(filters.labelIds === null ? {} : { labelIds: [...filters.labelIds] }),
    activeOnly,
    parentTaskId: null,
  };
}
export function useListTasks(
  projectId: string | null,
  activeOnly: boolean,
  filters: ListTaskFilters,
) {
  return useTaskRows(listTasksQuery(projectId, activeOnly, filters));
}
export function useLabels(projectIds: readonly string[]) {
  const query = experimental_useRpcKeyedQuery<Label[]>({
    method: "getLabelsKeyed",
    keys: projectIds,
  });
  const data = useMemo(
    () =>
      query.isLoading ? undefined : Object.values(query.data ?? {}).flat(),
    [query.data, query.isLoading],
  );
  return {
    data,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refresh: query.refetch,
  };
}
export interface TaskRowMeta {
  activeThreads: TaskThread[];
}
export function useTaskListMeta(projectId: string | null) {
  const tasks = useTaskRows({
    ...(projectId === null ? {} : { projectId }),
    activeOnly: true,
    parentTaskId: null,
  });
  const query = experimental_useRpcKeyedQuery<
    TaskThread[],
    Record<string, TaskRowMeta>
  >({
    method: "getTaskThreadsKeyed",
    keys: tasks.data?.map((task) => task.id) ?? [],
    select: (rows) =>
      Object.fromEntries(
        Object.entries(rows).flatMap(([id, threads]) => {
          const activeThreads = threads.filter(isActiveThread);
          return activeThreads.length ? [[id, { activeThreads }]] : [];
        }),
      ),
  });
  const data = useMemo(
    () => new Map(Object.entries(query.data ?? {})),
    [query.data],
  );
  return {
    data,
    isLoading: tasks.isLoading || query.isLoading,
    error: tasks.error ?? query.error?.message ?? null,
    refresh: () => {
      tasks.refresh();
      void query.refetch();
    },
  };
}
