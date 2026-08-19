import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
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

/** Typed RPC client bound to the tasks contract. */
export function useTasksRpc() {
  return useRpc<TasksRpcContract>();
}

export type TasksRpc = ReturnType<typeof useTasksRpc>;

export interface TaskListQuery {
  projectId?: string;
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  labelIds?: string[];
  activeOnly?: boolean;
  parentTaskId?: string | null;
  search?: string;
  sort?: TaskSort;
}

/** Traverse stable keyset pages while preserving the UI's complete-list views. */
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

export const INVALIDATION_CHANNELS = [
  "tasks:changed",
  "projects:changed",
  "comments:changed",
  "threads:changed",
] as const;

export type InvalidationChannel = (typeof INVALIDATION_CHANNELS)[number];

/**
 * Re-runs `onInvalidate` whenever the backend publishes on any of the given
 * realtime channels. The subscription set is fixed (one per known channel) so
 * callers may pass a fresh `channels` array every render.
 */
export function useInvalidation(
  channels: readonly InvalidationChannel[],
  onInvalidate: () => void,
): void {
  const ref = useRef({ channels, onInvalidate });
  ref.current = { channels, onInvalidate };
  const fire = useCallback((channel: InvalidationChannel) => {
    if (ref.current.channels.includes(channel)) ref.current.onInvalidate();
  }, []);
  useRealtime("tasks:changed", () => fire("tasks:changed"));
  useRealtime("projects:changed", () => fire("projects:changed"));
  useRealtime("comments:changed", () => fire("comments:changed"));
  useRealtime("threads:changed", () => fire("threads:changed"));
}

export interface TasksQuery<T> {
  data: T | undefined;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
}

/**
 * Fetch-and-subscribe primitive: runs `fetcher` on mount and again whenever
 * one of `channels` fires or `deps` change. Stale responses (superseded by a
 * newer refresh) are dropped.
 *
 * Generation bumps (manual refresh / reconnect) report begin/end to the shared
 * refresh provider so the header control can single-flight without a timer.
 * Invalidation- and deps-driven refetches do not mark the shared in-flight bit.
 */
export interface TasksQuerySnapshot<T> {
  /** Storage name; the value is validated against `schema` on every read. */
  name: string;
  schema: z.ZodType<T>;
}

export function useTasksQuery<T>(
  fetcher: (rpc: TasksRpc) => Promise<T>,
  channels: readonly InvalidationChannel[],
  deps: readonly unknown[] = [],
  options: {
    /**
     * Seed the first render with the last result this browser saw for the
     * query and keep that record fresh after every successful fetch. Use for
     * small, shape-stable results whose absence forces a wrong-shaped loading
     * UI (the sidebar's project list, its counts). `isLoading` still reports
     * the in-flight fetch; only `data` starts populated.
     */
    snapshot?: TasksQuerySnapshot<T>;
  } = {},
): TasksQuery<T> {
  const rpc = useTasksRpc();
  const { generation, beginGenerationWork, endGenerationWork } =
    useTasksRefresh();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const snapshotRef = useRef(options.snapshot);
  snapshotRef.current = options.snapshot;
  const [state, setState] = useState<{
    data: T | undefined;
    error: string | null;
    isLoading: boolean;
  }>(() => ({
    data:
      options.snapshot === undefined
        ? undefined
        : readQuerySnapshot(options.snapshot.name, options.snapshot.schema),
    error: null,
    isLoading: true,
  }));
  const seqRef = useRef(0);
  const previousGenerationRef = useRef(generation);
  const depsKey = JSON.stringify(deps);
  // The deps key whose result `data` currently holds. A refetch of the same
  // key that fails keeps the rows it had (they are still this key's truth);
  // a failed fetch for a changed key drops them, because those rows belong to
  // a different scope and the error must not be presented over them.
  const dataDepsKeyRef = useRef(depsKey);
  const refresh = useCallback(() => {
    const seq = ++seqRef.current;
    const snapshot = snapshotRef.current;
    const snapshotRevision =
      snapshot === undefined ? 0 : claimQuerySnapshotRevision(snapshot.name);
    return fetcherRef.current(rpc).then(
      (data) => {
        if (snapshot !== undefined) {
          // Persist even when this instance has moved on: the revision order
          // is what keeps an older response from replacing a newer record.
          writeQuerySnapshot(snapshot.name, data, snapshotRevision);
        }
        if (seq !== seqRef.current) return;
        dataDepsKeyRef.current = depsKey;
        setState({ data, error: null, isLoading: false });
      },
      (error: unknown) => {
        if (seq !== seqRef.current) return;
        const keepsData = dataDepsKeyRef.current === depsKey;
        setState((current) => ({
          data: keepsData ? current.data : undefined,
          error: error instanceof Error ? error.message : String(error),
          isLoading: false,
        }));
      },
    );
  }, [rpc, depsKey]);
  useEffect(() => {
    const generationBumped = previousGenerationRef.current !== generation;
    previousGenerationRef.current = generation;
    setState((current) => ({ ...current, isLoading: true }));
    if (generationBumped) beginGenerationWork();
    let settled = false;
    const finish = () => {
      if (!generationBumped || settled) return;
      settled = true;
      endGenerationWork();
    };
    void refresh().finally(finish);
    return () => {
      finish();
    };
  }, [refresh, generation, beginGenerationWork, endGenerationWork]);
  useInvalidation(channels, refresh);
  return { ...state, refresh };
}

const foldersSnapshot = {
  name: "folders",
  schema: tasksRpcContract.listFolders.output.shape.folders,
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
  schema: tasksRpcContract.listProjects.output.shape.projects,
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
  schema: tasksRpcContract.sidebarSummary.output.shape.projects,
};

export function useSidebarSummary() {
  return useTasksQuery(
    async (rpc) => (await rpc.call("sidebarSummary")).projects,
    ["tasks:changed", "projects:changed", "threads:changed"],
    [],
    { snapshot: sidebarSummarySnapshot },
  );
}

/**
 * @-mention source for TasksEditor: tasks matched by key/title/description
 * via the server-side `listTasks` search, followed by bb threads from
 * `searchThreads`. A thread-search failure must not take task mentions down
 * with it, so it degrades to an empty section.
 */
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

/** Tasks with agents currently working, for the Active view count. */
export function useActiveTasks() {
  return useTasksQuery(
    async (rpc) => listAllTasks(rpc, { activeOnly: true }),
    ["tasks:changed", "threads:changed"],
  );
}
