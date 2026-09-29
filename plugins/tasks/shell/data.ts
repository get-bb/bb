import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_useRpcQuery,
  experimental_useRpcInfiniteQuery,
  useRpc,
  useRealtime,
} from "@get-bb/plugin-sdk/app";
import type { PluginRpcResult } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { errorMessage } from "../shared/errors.js";
import {
  TASK_STATUSES,
  tasksRpcContract,
  type TasksRpcContract,
} from "../shared/contract.js";
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

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = TASK_STATUSES.filter(
  (status) => status !== "done" && status !== "canceled",
);

const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ["done", "canceled"];

export async function listTasksOpenFirst(
  rpc: TasksRpc,
  input: Omit<TaskListQuery, "statuses">,
  publish: (open: Task[]) => void,
): Promise<Task[]> {
  const openRequest = listAllTasks(rpc, {
    ...input,
    statuses: [...OPEN_TASK_STATUSES],
  }).then((open) => {
    publish(open);
    return open;
  });
  const closedRequest = listAllTasks(rpc, {
    ...input,
    statuses: [...CLOSED_TASK_STATUSES],
  });
  const [open, closed] = await Promise.all([openRequest, closedRequest]);
  const byId = new Map<string, Task>();
  for (const task of open) byId.set(task.id, task);
  for (const task of closed) byId.set(task.id, task);
  return [...byId.values()];
}

export async function patchTasks(
  rpc: TasksRpc,
  current: readonly Task[],
  taskIds: readonly string[],
  belongs: (task: Task) => boolean,
): Promise<Task[]> {
  if (taskIds.length === 0) return [...current];
  const fetched = await Promise.all(
    taskIds.map(async (taskId) => {
      const { task } = await rpc.call("getTask", { taskId });
      return [taskId, task] as const;
    }),
  );
  const updates = new Map(fetched);
  const next: Task[] = [];
  for (const task of current) {
    if (!updates.has(task.id)) {
      next.push(task);
      continue;
    }
    const updated = updates.get(task.id) ?? null;
    updates.delete(task.id);
    if (updated !== null && belongs(updated)) next.push(updated);
  }
  for (const task of updates.values()) {
    if (task !== null && belongs(task)) next.push(task);
  }
  return next;
}

const INVALIDATION_CHANNELS = [
  "tasks:changed",
  "projects:changed",
  "comments:changed",
  "threads:changed",
] as const;

type InvalidationChannel = (typeof INVALIDATION_CHANNELS)[number];

export interface TaskSignal {
  channel: InvalidationChannel;
  taskId: string | null;
}

const SIGNAL_BATCH_MS = 50;

function signalTaskId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const taskId: unknown = Reflect.get(payload, "taskId");
  return typeof taskId === "string" ? taskId : null;
}

export function signalTaskIds(
  signals: readonly TaskSignal[],
  channel: InvalidationChannel,
): string[] {
  const ids = new Set<string>();
  for (const signal of signals) {
    if (signal.channel === channel && signal.taskId !== null) {
      ids.add(signal.taskId);
    }
  }
  return [...ids];
}

function useSignalBatches(
  channels: readonly InvalidationChannel[],
  onBatch: (signals: TaskSignal[]) => void,
): void {
  const ref = useRef({ channels, onBatch });
  ref.current = { channels, onBatch };
  const pending = useRef<TaskSignal[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      pending.current = [];
    },
    [],
  );
  const push = useCallback((channel: InvalidationChannel, payload: unknown) => {
    if (!ref.current.channels.includes(channel)) return;
    pending.current.push({ channel, taskId: signalTaskId(payload) });
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const batch = pending.current;
      pending.current = [];
      if (batch.length > 0) ref.current.onBatch(batch);
    }, SIGNAL_BATCH_MS);
  }, []);
  useRealtime("tasks:changed", (payload) => push("tasks:changed", payload));
  useRealtime("projects:changed", (payload) =>
    push("projects:changed", payload),
  );
  useRealtime("comments:changed", (payload) =>
    push("comments:changed", payload),
  );
  useRealtime("threads:changed", (payload) => push("threads:changed", payload));
}

export function tasksQuerySignals(
  channels: readonly InvalidationChannel[],
  input: object | null,
) {
  return channels.map((channel) => ({
    channel,
    affects: (payload: unknown) => {
      if (typeof payload !== "object" || payload === null || input === null)
        return true;
      const taskId = "taskId" in payload ? payload.taskId : null;
      const projectId = "projectId" in payload ? payload.projectId : null;
      if (typeof taskId === "string") {
        if ("taskId" in input && typeof input.taskId === "string")
          return taskId === input.taskId;
        if ("taskIds" in input && Array.isArray(input.taskIds))
          return input.taskIds.includes(taskId);
      }
      if (typeof projectId === "string") {
        if ("projectId" in input && typeof input.projectId === "string")
          return projectId === input.projectId;
        if ("projectIds" in input && Array.isArray(input.projectIds))
          return input.projectIds.includes(projectId);
      }
      return true;
    },
  }));
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

type ApplySignals<T> = (
  rpc: TasksRpc,
  current: T,
  signals: readonly TaskSignal[],
) => Promise<T | null>;

export function useTasksQuery<T>(
  fetcher: (rpc: TasksRpc, publish: (partial: T) => void) => Promise<T>,
  channels: readonly InvalidationChannel[],
  deps: readonly unknown[] = [],
  options: {
    snapshot?: TasksQuerySnapshot<T>;
    applySignals?: ApplySignals<T>;
  } = {},
): TasksQuery<T> {
  const rpc = useTasksRpc();
  const { generation, beginGenerationWork, endGenerationWork } =
    useTasksRefresh();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const snapshotRef = useRef(options.snapshot);
  snapshotRef.current = options.snapshot;
  const applySignalsRef = useRef(options.applySignals);
  applySignalsRef.current = options.applySignals;
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
  const dataRef = useRef(state.data);
  const inFlightRef = useRef(0);
  const patchChainRef = useRef<Promise<void>>(Promise.resolve());
  const previousGenerationRef = useRef(generation);
  const depsKey = JSON.stringify(deps);
  const dataDepsKeyRef = useRef(depsKey);
  const refresh = useCallback(() => {
    const seq = ++seqRef.current;
    const snapshot = snapshotRef.current;
    const snapshotRevision =
      snapshot === undefined ? 0 : claimQuerySnapshotRevision(snapshot.name);
    const publish = (partial: T) => {
      if (seq !== seqRef.current) return;
      dataDepsKeyRef.current = depsKey;
      dataRef.current = partial;
      setState({ data: partial, error: null, isLoading: true });
    };
    inFlightRef.current += 1;
    return fetcherRef
      .current(rpc, publish)
      .then(
        (data) => {
          if (snapshot !== undefined) {
            writeQuerySnapshot(snapshot.name, data, snapshotRevision);
          }
          if (seq !== seqRef.current) return;
          dataDepsKeyRef.current = depsKey;
          dataRef.current = data;
          setState({ data, error: null, isLoading: false });
        },
        (error: unknown) => {
          if (seq !== seqRef.current) return;
          const keepsData = dataDepsKeyRef.current === depsKey;
          if (!keepsData) dataRef.current = undefined;
          setState((current) => ({
            data: keepsData ? current.data : undefined,
            error: errorMessage(error),
            isLoading: false,
          }));
        },
      )
      .finally(() => {
        inFlightRef.current -= 1;
      });
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
  const onSignals = useCallback(
    (signals: TaskSignal[]) => {
      const apply = applySignalsRef.current;
      if (
        apply === undefined ||
        inFlightRef.current > 0 ||
        signals.some((signal) => signal.taskId === null)
      ) {
        void refresh();
        return;
      }
      const seq = seqRef.current;
      patchChainRef.current = patchChainRef.current.then(async () => {
        const current = dataRef.current;
        if (seq !== seqRef.current || current === undefined) return;
        let next: T | null;
        try {
          next = await apply(rpc, current, signals);
        } catch {
          next = null;
        }
        if (seq !== seqRef.current) return;
        if (next === null) {
          void refresh();
          return;
        }
        if (next === current) return;
        dataRef.current = next;
        setState((previous) => ({ ...previous, data: next }));
      });
    },
    [refresh, rpc],
  );
  useSignalBatches(channels, onSignals);
  return { ...state, refresh };
}

export function useTasksRead<
  Method extends keyof TasksRpcContract,
  Data = PluginRpcResult<TasksRpcContract[Method]>,
>(
  method: Method,
  input: z.input<TasksRpcContract[Method]["input"]>,
  select: (result: PluginRpcResult<TasksRpcContract[Method]>) => Data,
  channels: readonly InvalidationChannel[],
  options: { snapshot?: TasksQuerySnapshot<Data>; enabled?: boolean } = {},
): TasksQuery<Data> {
  const query = experimental_useRpcQuery({
    contract: tasksRpcContract,
    method,
    input,
    enabled: options.enabled,
    realtime: tasksQuerySignals(channels, input),
  });
  const enabled = options.enabled ?? true;
  const refetch = query.refetch;
  const refresh = useCallback(async () => {
    if (enabled) await refetch();
  }, [enabled, refetch]);
  useTasksQueryRefresh(refresh);
  const [snapshot] = useState(() =>
    options.snapshot === undefined
      ? undefined
      : readQuerySnapshot(options.snapshot.name, options.snapshot.schema),
  );
  const data = !enabled
    ? undefined
    : query.data === undefined
      ? snapshot
      : select(query.data);
  const snapshotName = options.snapshot?.name;
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  }, [select]);
  useEffect(() => {
    if (query.data === undefined || snapshotName === undefined) return;
    writeQuerySnapshot(
      snapshotName,
      selectRef.current(query.data),
      claimQuerySnapshotRevision(snapshotName),
    );
  }, [query.data, snapshotName]);
  return {
    data,
    error: query.error?.message ?? null,
    isLoading: query.isLoading,
    refresh,
  };
}

export function useAllTasks(
  input: TaskListQuery,
  channels: readonly InvalidationChannel[],
) {
  const query = experimental_useRpcInfiniteQuery<
    TasksRpcContract,
    "listTasks",
    string | null
  >({
    contract: tasksRpcContract,
    method: "listTasks",
    input: { ...input, limit: TASKS_PAGE_MAX_LIMIT },
    initialPageParam: null,
    getPageInput: (input, cursor: string | null) => ({
      ...input,
      ...(cursor === null ? {} : { cursor }),
    }),
    getNextPageParam: (page) => page.nextCursor,
    realtime: tasksQuerySignals(channels, input),
  });
  useTasksQueryRefresh(query.refetch);
  const { hasNextPage, isFetching, error, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetching && error === null) void fetchNextPage();
  }, [hasNextPage, isFetching, error, fetchNextPage]);
  const data = useMemo(
    () => query.data?.pages.flatMap((page) => page.tasks),
    [query.data],
  );
  return {
    data,
    error: query.error?.message ?? null,
    isLoading: query.isLoading || (query.hasNextPage && query.error === null),
    refresh: query.isFetchNextPageError ? query.fetchNextPage : query.refetch,
  };
}

const foldersSnapshot = {
  name: "folders",
  schema: tasksRpcContract.listFolders.output.shape.folders,
};

export function useFolders() {
  return useTasksRead(
    "listFolders",
    null,
    (result) => result.folders,
    ["projects:changed"],
    { snapshot: foldersSnapshot },
  );
}

const projectsSnapshot = {
  name: "projects",
  schema: tasksRpcContract.listProjects.output.shape.projects,
};

export function useProjects() {
  return useTasksRead(
    "listProjects",
    {},
    (result) => result.projects,
    ["projects:changed"],
    { snapshot: projectsSnapshot },
  );
}

export function usePresets() {
  return useTasksRead("listPresets", null, (result) => result.presets, [
    "projects:changed",
  ]);
}

const sidebarSummarySnapshot = {
  name: "sidebar-summary",
  schema: tasksRpcContract.sidebarSummary.output.shape.projects,
};

export function useSidebarSummary() {
  return useTasksRead(
    "sidebarSummary",
    null,
    (result) => result.projects,
    ["tasks:changed", "projects:changed", "threads:changed"],
    { snapshot: sidebarSummarySnapshot },
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
  return useAllTasks({ activeOnly: true }, [
    "tasks:changed",
    "threads:changed",
  ]);
}

export function useTasksQueryRefresh(refetch: () => Promise<void>): void {
  const { manualGeneration, beginGenerationWork, endGenerationWork } =
    useTasksRefresh();
  const previous = useRef(manualGeneration);
  useEffect(() => {
    if (previous.current === manualGeneration) return;
    previous.current = manualGeneration;
    beginGenerationWork();
    void refetch().finally(endGenerationWork);
  }, [manualGeneration, refetch, beginGenerationWork, endGenerationWork]);
}
