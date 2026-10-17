import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useRpc,
  experimental_useRpcQuery,
  experimental_useRpcKeyedQuery,
  experimental_useRpcMutation,
  type StandardSchemaV1InferInput,
  type PluginRpcResult,
} from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import {
  tasksRpcContract,
  type TasksRpcContract,
  type TaskSummary,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../shared/contract.js";
import { applyEdit } from "../shared/task-edit.js";
import { sortTasks } from "../shared/sort.js";
import { TASKS_PAGE_MAX_LIMIT, type TaskSort } from "../shared/pagination.js";
import type { MentionItem } from "../editor/extensions.js";
import { readQuerySnapshot, writeQuerySnapshot } from "./query-snapshot.js";
export function useTasksRpc() {
  return useRpc<TasksRpcContract>();
}
export type TasksRpc = ReturnType<typeof useTasksRpc>;
export interface TasksQuery<T> {
  data: T | undefined;
  error: string | null;
  isLoading: boolean;
  refresh(): void;
}
export function useTaskRead<Method extends keyof TasksRpcContract & string, T>(
  method: Method,
  input: StandardSchemaV1InferInput<TasksRpcContract[Method]["input"]>,
  select: (result: PluginRpcResult<TasksRpcContract[Method]>) => T,
  enabled = true,
): TasksQuery<T> {
  const query = experimental_useRpcQuery<TasksRpcContract, Method>({
    method,
    input,
    enabled,
  });
  return {
    data: query.data === undefined ? undefined : select(query.data),
    error: query.error?.message ?? null,
    isLoading: query.isLoading,
    refresh: query.refetch,
  };
}

export function useTaskMutation<Method extends keyof TasksRpcContract & string>(
  method: Method,
) {
  return experimental_useRpcMutation<TasksRpcContract, Method>({ method })
    .mutate;
}

export function useTaskUpdateMutation(
  taskKeyFor: (taskId: string) => string | undefined,
) {
  return experimental_useRpcMutation<TasksRpcContract, "updateTask">({
    method: "updateTask",
    optimistic(input, cache) {
      cache.updateKey("getTasksKeyed", input.taskId, (current) =>
        current === null ? null : applyEdit(current, input),
      );
      const update = (current: { task: Task | null }) => ({
        ...current,
        task:
          current.task === null
            ? null
            : {
                ...applyEdit(current.task, input),
                ...(input.description !== undefined
                  ? { description: input.description }
                  : {}),
                ...(input.parentTaskId !== undefined
                  ? { parentTaskId: input.parentTaskId }
                  : {}),
              },
      });
      cache.update("getTask", { taskId: input.taskId }, update);
      const taskKey = taskKeyFor(input.taskId);
      if (taskKey !== undefined)
        cache.update("getTaskByKey", { taskKey }, update);
    },
  });
}

export function useTaskRows(
  input: StandardSchemaV1InferInput<
    TasksRpcContract["taskMembership"]["input"]
  >,
): TasksQuery<TaskSummary[]> {
  const membership = useTaskRead("taskMembership", input, (value) => value);
  const rows = experimental_useRpcKeyedQuery<TaskSummary | null>({
    method: "getTasksKeyed",
    keys: membership.data?.keys ?? [],
  });
  const identity = JSON.stringify(input);
  const [loaded, setLoaded] = useState<string>();
  const openKeys = useMemo(
    () => membership.data?.keys.slice(0, membership.data.openCount) ?? [],
    [membership.data],
  );
  const openPending =
    loaded !== identity &&
    rows.error === null &&
    openKeys.some((key) => rows.data?.[key] === undefined);
  if (membership.data !== undefined && !openPending && loaded !== identity)
    setLoaded(identity);
  const data = useMemo(() => {
    if (
      !membership.data ||
      (rows.isLoading && Object.keys(rows.data ?? {}).length === 0)
    )
      return undefined;
    return sortTasks(
      (openPending ? openKeys : membership.data.keys).flatMap((key) =>
        rows.data?.[key] ? [rows.data[key]!] : [],
      ),
      "manual",
    );
  }, [membership.data, rows.data, rows.isLoading, openPending, openKeys]);
  return {
    data,
    error: membership.error ?? rows.error?.message ?? null,
    isLoading: membership.isLoading || rows.isLoading,
    refresh: () => {
      membership.refresh();
      void rows.refetch();
    },
  };
}

function useSnapshot<T>(
  query: TasksQuery<T>,
  name: string,
  schema: z.ZodType<T>,
): TasksQuery<T> {
  useEffect(() => {
    if (query.data !== undefined) writeQuerySnapshot(name, query.data);
  }, [query.data, name]);
  return { ...query, data: query.data ?? readQuerySnapshot(name, schema) };
}
export function useFolders() {
  return useSnapshot(
    useTaskRead("listFolders", null, (value) => value.folders),
    "folders",
    tasksRpcContract.listFolders.output.shape.folders,
  );
}
export function useProjects() {
  return useSnapshot(
    useTaskRead("listProjects", {}, (value) => value.projects),
    "projects",
    tasksRpcContract.listProjects.output.shape.projects,
  );
}
export function useSidebarSummary() {
  return useSnapshot(
    useTaskRead("sidebarSummary", null, (value) => value.projects),
    "sidebar-summary",
    tasksRpcContract.sidebarSummary.output.shape.projects,
  );
}
export function usePresets() {
  return useTaskRead("listPresets", null, (value) => value.presets);
}
export function useActiveTasks() {
  return useTaskRows({ activeOnly: true });
}
export function useMentionItems() {
  const rpc = useTasksRpc();
  return useCallback(
    async (query: string): Promise<MentionItem[]> => {
      const trimmed = query.trim();
      const [taskResult, threadResult] = await Promise.all([
        rpc.call("listTasks", {
          ...(trimmed ? { search: trimmed } : {}),
          limit: 8,
        }),
        rpc
          .call("searchThreads", { query: trimmed, limit: 5 })
          .catch(() => ({ threads: [] })),
      ]);
      return [
        ...taskResult.tasks.slice(0, 8).map((task) => ({
          type: "task" as const,
          id: task.id,
          key: task.key,
          title: task.title,
        })),
        ...threadResult.threads.map((thread) => ({
          type: "thread" as const,
          id: thread.id,
          title: thread.title,
        })),
      ];
    },
    [rpc],
  );
}

interface TaskListQuery {
  projectId?: string;
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  labelIds?: string[];
  activeOnly?: boolean;
  parentTaskId?: string | null;
  search?: string;
  sort?: TaskSort;
}

export async function listAllTasks(
  rpc: TasksRpc,
  input: TaskListQuery = {},
): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor: string | undefined;
  do {
    const page = await rpc.call("listTasks", {
      ...input,
      limit: TASKS_PAGE_MAX_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    tasks.push(...page.tasks);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return tasks;
}
