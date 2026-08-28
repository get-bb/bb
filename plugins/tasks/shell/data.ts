import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc, type JsonValue } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { tasksRpcContract, type TasksRpcContract } from "../shared/contract.js";
import type { Task, TaskPriority, TaskStatus } from "../shared/contract.js";
import { TASKS_PAGE_MAX_LIMIT, type TaskSort } from "../shared/pagination.js";
import type { MentionItem } from "../editor/extensions.js";
import {
  claimQuerySnapshotRevision,
  readQuerySnapshot,
  writeQuerySnapshot,
} from "./query-snapshot.js";
import { useTasksRefresh } from "./refresh.js";

export function useTasksRpc() {
  return useRpc<TasksRpcContract>();
}

export type TasksRpc = ReturnType<typeof useTasksRpc>;

type TaskQueryFailure = Error | JsonValue | bigint | symbol | undefined;

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
    const page =
      cursor === undefined
        ? await rpc.call("listTasks", {
            ...input,
            limit: TASKS_PAGE_MAX_LIMIT,
          })
        : await rpc.call("listTasks", {
            ...input,
            limit: TASKS_PAGE_MAX_LIMIT,
            cursor,
          });
    tasks.push(...page.tasks);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return tasks;
}

const INVALIDATION_CHANNELS = [
  "tasks:changed",
  "projects:changed",
  "comments:changed",
  "threads:changed",
] as const;

type InvalidationChannel = (typeof INVALIDATION_CHANNELS)[number];

function useInvalidation(
  channels: readonly InvalidationChannel[],
  onInvalidate: () => void,
): void {
  const ref = useRef({ channels, onInvalidate });
  useEffect(() => {
    ref.current = { channels, onInvalidate };
  }, [channels, onInvalidate]);
  const fire = useCallback((channel: InvalidationChannel) => {
    if (ref.current.channels.includes(channel)) ref.current.onInvalidate();
  }, []);
  useRealtime("tasks:changed", () => fire("tasks:changed"));
  useRealtime("projects:changed", () => fire("projects:changed"));
  useRealtime("comments:changed", () => fire("comments:changed"));
  useRealtime("threads:changed", () => fire("threads:changed"));
}

interface TasksQuery<T> {
  data: T | undefined;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
}

interface TasksQuerySnapshot<T> {
  name: string;
  schema: z.ZodType<T>;
}

export function useTasksQuery<T>(
  fetcher: (rpc: TasksRpc) => Promise<T>,
  channels: readonly InvalidationChannel[],
  deps: readonly unknown[] = [],
  options: {
    snapshot?: TasksQuerySnapshot<T>;
  } = {},
): TasksQuery<T> {
  const rpc = useTasksRpc();
  const { generation, beginGenerationWork, endGenerationWork } =
    useTasksRefresh();
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);
  const snapshotRef = useRef(options.snapshot);
  useEffect(() => {
    snapshotRef.current = options.snapshot;
  }, [options.snapshot]);
  const depsKey = JSON.stringify(deps);
  const [state, setState] = useState<{
    data: T | undefined;
    error: string | null;
    isLoading: boolean;
    resolvedDepsKey: string;
    resolvedGeneration: number;
  }>(() => ({
    data:
      options.snapshot === undefined
        ? undefined
        : readQuerySnapshot(options.snapshot.name, options.snapshot.schema),
    error: null,
    isLoading: true,
    resolvedDepsKey: depsKey,
    resolvedGeneration: generation,
  }));
  const seqRef = useRef(0);
  const previousGenerationRef = useRef(generation);
  const dataDepsKeyRef = useRef(depsKey);
  const runRefresh = useCallback(() => {
    const seq = ++seqRef.current;
    const snapshot = snapshotRef.current;
    const snapshotRevision =
      snapshot === undefined ? 0 : claimQuerySnapshotRevision(snapshot.name);
    return fetcherRef.current(rpc).then(
      (data) => {
        if (snapshot !== undefined) {
          writeQuerySnapshot(snapshot.name, data, snapshotRevision);
        }
        if (seq !== seqRef.current) return;
        dataDepsKeyRef.current = depsKey;
        setState({
          data,
          error: null,
          isLoading: false,
          resolvedDepsKey: depsKey,
          resolvedGeneration: generation,
        });
      },
      (error: TaskQueryFailure) => {
        if (seq !== seqRef.current) return;
        const keepsData = dataDepsKeyRef.current === depsKey;
        setState((current) => ({
          data: keepsData ? current.data : undefined,
          error: error instanceof Error ? error.message : String(error),
          isLoading: false,
          resolvedDepsKey: depsKey,
          resolvedGeneration: generation,
        }));
      },
    );
  }, [rpc, depsKey, generation]);
  const refresh = useCallback(() => {
    setState((current) => ({ ...current, isLoading: true }));
    return runRefresh();
  }, [runRefresh]);
  useEffect(() => {
    const generationBumped = previousGenerationRef.current !== generation;
    previousGenerationRef.current = generation;
    if (generationBumped) beginGenerationWork();
    let settled = false;
    const finish = () => {
      if (!generationBumped || settled) return;
      settled = true;
      endGenerationWork();
    };
    void runRefresh().finally(finish);
    return () => {
      finish();
    };
  }, [runRefresh, generation, beginGenerationWork, endGenerationWork]);
  useInvalidation(channels, refresh);
  return {
    data: state.data,
    error: state.error,
    isLoading:
      state.isLoading ||
      state.resolvedDepsKey !== depsKey ||
      state.resolvedGeneration !== generation,
    refresh,
  };
}

const foldersSnapshot = {
  name: "folders",
  schema: z
    .preprocess(
      (value) => ({ folders: value }),
      tasksRpcContract.listFolders.output,
    )
    .transform((value) => value.folders),
};

export function useFolders() {
  return useTasksQuery(
    async (rpc) => (await rpc.call("listFolders")).folders,
    ["projects:changed"],
    [],
    { snapshot: foldersSnapshot },
  );
}

const projectsSnapshot = {
  name: "projects",
  schema: z
    .preprocess(
      (value) => ({ projects: value }),
      tasksRpcContract.listProjects.output,
    )
    .transform((value) => value.projects),
};

export function useProjects() {
  return useTasksQuery(
    async (rpc) => (await rpc.call("listProjects", {})).projects,
    ["projects:changed"],
    [],
    { snapshot: projectsSnapshot },
  );
}

export function usePresets() {
  return useTasksQuery(
    async (rpc) => (await rpc.call("listPresets")).presets,
    ["projects:changed"],
  );
}

const sidebarSummarySnapshot = {
  name: "sidebar-summary",
  schema: z
    .preprocess(
      (value) => ({ projects: value }),
      tasksRpcContract.sidebarSummary.output,
    )
    .transform((value) => value.projects),
};

export function useSidebarSummary() {
  return useTasksQuery(
    async (rpc) => (await rpc.call("sidebarSummary")).projects,
    ["tasks:changed", "projects:changed", "threads:changed"],
    [],
    { snapshot: sidebarSummarySnapshot },
  );
}

export function useMentionItems() {
  const rpc = useTasksRpc();
  return useCallback(
    async (query: string): Promise<MentionItem[]> => {
      const trimmed = query.trim();
      const taskRequest = trimmed
        ? rpc.call("listTasks", { search: trimmed, limit: 8 })
        : rpc.call("listTasks", { limit: 8 });
      const [taskResult, threadResult] = await Promise.all([
        taskRequest,
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
  return useTasksQuery(
    async (rpc) => listAllTasks(rpc, { activeOnly: true }),
    ["tasks:changed", "threads:changed"],
  );
}
