import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { experimental_useRpcQuery, useRpc } from "@get-bb/plugin-sdk/app";
import type {
  PluginRpcResult,
  StandardSchemaV1InferInput,
} from "@get-bb/plugin-sdk";
import type { z } from "zod";
import {
  TASK_STATUSES,
  tasksRpcContract,
  type TasksRpcContract,
} from "../shared/contract.js";
import type { TaskStatus } from "../shared/contract.js";
import type { MentionItem } from "../editor/extensions.js";
import { readQuerySnapshot, writeQuerySnapshot } from "./query-snapshot.js";

export function useTasksRpc() {
  return useRpc<TasksRpcContract>();
}

export type TasksRpc = ReturnType<typeof useTasksRpc>;

type TasksMethod = keyof TasksRpcContract & string;
export type TasksInput<Method extends TasksMethod> = StandardSchemaV1InferInput<
  TasksRpcContract[Method]["input"]
>;
type TasksResult<Method extends TasksMethod> = PluginRpcResult<
  TasksRpcContract[Method]
>;

export interface TasksQuery<T> {
  data: T | undefined;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
}

export function useTasksQuery<Method extends TasksMethod, T>(
  method: Method,
  input: TasksInput<Method>,
  select: (result: TasksResult<Method>) => T,
  options: { enabled?: boolean } = {},
): TasksQuery<T> {
  const query = experimental_useRpcQuery({
    contract: tasksRpcContract,
    method,
    input,
    enabled: options.enabled,
  });
  const result = query.data;
  const data = useMemo(
    () => (result === undefined ? undefined : select(result)),
    [result, select],
  );
  const refetch = useRef(query.refetch);
  useEffect(() => {
    refetch.current = query.refetch;
  });
  const refresh = useCallback(() => {
    void refetch.current();
  }, []);
  return {
    data,
    error: query.error?.message ?? null,
    isLoading: query.isLoading,
    refresh,
  };
}

function useSnapshotQuery<T>(
  name: string,
  schema: z.ZodType<T>,
  query: TasksQuery<T>,
): TasksQuery<T> {
  const [snapshot] = useState(() => readQuerySnapshot(name, schema));
  useEffect(() => {
    if (query.data !== undefined) writeQuerySnapshot(name, query.data);
  }, [name, query.data]);
  return query.data === undefined ? { ...query, data: snapshot } : query;
}

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = TASK_STATUSES.filter(
  (status) => status !== "done" && status !== "canceled",
);

export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ["done", "canceled"];

export const selectTasks = (result: TasksResult<"listAllTasks">) =>
  result.tasks;
export const selectLabels = (result: TasksResult<"listLabels">) =>
  result.labels;
export const selectCards = (result: TasksResult<"listTaskCardMeta">) =>
  result.cards;
export const selectProjects = (result: TasksResult<"listProjects">) =>
  result.projects;
export const selectPresets = (result: TasksResult<"listPresets">) =>
  result.presets;
export const selectMachines = (result: TasksResult<"listMachines">) =>
  result.machines;
export const selectBbProjects = (result: TasksResult<"listBbProjects">) =>
  result.bbProjects;
const selectFolders = (result: TasksResult<"listFolders">) => result.folders;
const selectSummary = (result: TasksResult<"sidebarSummary">) =>
  result.projects;

export function useFolders() {
  return useSnapshotQuery(
    "folders",
    tasksRpcContract.listFolders.output.shape.folders,
    useTasksQuery("listFolders", null, selectFolders),
  );
}

export function useProjects() {
  return useSnapshotQuery(
    "projects",
    tasksRpcContract.listProjects.output.shape.projects,
    useTasksQuery("listProjects", {}, selectProjects),
  );
}

export function usePresets() {
  return useTasksQuery("listPresets", null, selectPresets);
}

export function useSidebarSummary() {
  return useSnapshotQuery(
    "sidebar-summary",
    tasksRpcContract.sidebarSummary.output.shape.projects,
    useTasksQuery("sidebarSummary", null, selectSummary),
  );
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

export function useActiveTasks() {
  return useTasksQuery("listAllTasks", { activeOnly: true }, selectTasks);
}
