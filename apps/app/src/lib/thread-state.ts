import { useMemo, useSyncExternalStore } from "react";
import { hashKey, type QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  ExperimentalThread,
  ExperimentalThreadState,
} from "@get-bb/plugin-sdk";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { useThread } from "@/hooks/queries/thread-queries";
import { BbHttpError } from "@/lib/sdk";
import {
  useSidebarThreadEntriesStore,
  type SidebarThreadEntriesStore,
} from "./sidebar-thread-entries";

const LOADING: ExperimentalThreadState = { status: "loading", thread: null };
const NOT_FOUND: ExperimentalThreadState = { status: "notFound", thread: null };
const ERROR: ExperimentalThreadState = { status: "error", thread: null };

const stateBySource = new WeakMap<ThreadWithRuntime, ExperimentalThreadState>();

function stateOf(source: ThreadWithRuntime): ExperimentalThreadState {
  if (source.deletedAt !== null) return NOT_FOUND;
  const cached = stateBySource.get(source);
  if (cached !== undefined) return cached;
  const thread: ExperimentalThread = {
    id: source.id,
    projectId: source.projectId,
    environmentId: source.environmentId,
    providerId: source.providerId,
    title: source.title,
    titleFallback: source.titleFallback,
    sectionId: source.sectionId,
    status: source.status,
    parentThreadId: source.parentThreadId,
    lifecycleOwnerThreadId: source.lifecycleOwnerThreadId,
    sourceThreadId: source.sourceThreadId,
    originKind: source.originKind,
    originPluginId: source.originPluginId,
    visibility: source.visibility,
    parentNotifications: source.parentNotifications,
    archivedAt: source.archivedAt,
    pinnedAt: source.pinnedAt,
    deletedAt: source.deletedAt,
    lastReadAt: source.lastReadAt,
    latestAttentionAt: source.latestAttentionAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    runtime: source.runtime,
  };
  const state: ExperimentalThreadState = { status: "ready", thread };
  stateBySource.set(source, state);
  return state;
}

interface TrackedEntry {
  entry: ThreadListEntry;
  held: boolean;
}

function trackedEntrySource(
  store: SidebarThreadEntriesStore,
  threadId: string,
) {
  let last: TrackedEntry | null = null;
  return {
    subscribe: (listener: () => void) => store.subscribe(threadId, listener),
    getSnapshot: (): TrackedEntry | null => {
      const entry = store.get(threadId);
      if (entry !== null) {
        if (last?.entry !== entry || !last.held) last = { entry, held: true };
      } else if (last?.held) {
        last = { entry: last.entry, held: false };
      }
      return last;
    },
  };
}

function useTrackedSidebarEntry(threadId: string): TrackedEntry | null {
  const store = useSidebarThreadEntriesStore();
  const source = useMemo(
    () => trackedEntrySource(store, threadId),
    [store, threadId],
  );
  return useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot,
  );
}

interface ThreadFetch {
  data: ThreadWithRuntime | undefined;
  error: unknown;
}

export type ThreadRead =
  | { status: "loading" | "notFound" | "error" }
  | {
      status: "ready";
      thread: ThreadWithRuntime;
      entry: ThreadListEntry | null;
    };

const READ_LOADING: ThreadRead = { status: "loading" };
const READ_NOT_FOUND: ThreadRead = { status: "notFound" };
const READ_ERROR: ThreadRead = { status: "error" };
const readByEntry = new WeakMap<ThreadListEntry, ThreadRead>();
const readByFetched = new WeakMap<ThreadWithRuntime, ThreadRead>();

function readEntry(entry: ThreadListEntry): ThreadRead {
  if (entry.deletedAt !== null) return READ_NOT_FOUND;
  let read = readByEntry.get(entry);
  if (read === undefined) {
    read = { status: "ready", thread: entry, entry };
    readByEntry.set(entry, read);
  }
  return read;
}

function readFetched(thread: ThreadWithRuntime): ThreadRead {
  if (thread.deletedAt !== null) return READ_NOT_FOUND;
  let read = readByFetched.get(thread);
  if (read === undefined) {
    read = { status: "ready", thread, entry: null };
    readByFetched.set(thread, read);
  }
  return read;
}

function readThread(
  threadId: string,
  tracked: TrackedEntry | null,
  fetch: ThreadFetch,
): ThreadRead {
  if (threadId === "") return READ_NOT_FOUND;
  if (tracked?.held === true) return readEntry(tracked.entry);
  if (fetch.error instanceof BbHttpError && fetch.error.status === 404) {
    return READ_NOT_FOUND;
  }
  if (fetch.data !== undefined) return readFetched(fetch.data);
  if (fetch.error != null) return READ_ERROR;
  return tracked === null ? READ_LOADING : readEntry(tracked.entry);
}

export function threadReadSource(
  store: SidebarThreadEntriesStore,
  queryClient: QueryClient,
  threadId: string,
): { subscribe(listener: () => void): () => void; getSnapshot(): ThreadRead } {
  const tracked = trackedEntrySource(store, threadId);
  const queryHash = hashKey(threadQueryKey(threadId));
  const fetchOf = (): ThreadFetch => {
    const state = queryClient.getQueryState<ThreadWithRuntime>(
      threadQueryKey(threadId),
    );
    return { data: state?.data, error: state?.error ?? null };
  };
  return {
    subscribe: (listener) => {
      const releaseEntry = tracked.subscribe(listener);
      const releaseQuery = queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === queryHash) listener();
      });
      return () => {
        releaseEntry();
        releaseQuery();
      };
    },
    getSnapshot: () => readThread(threadId, tracked.getSnapshot(), fetchOf()),
  };
}

export function useThreadState(threadId: string): ExperimentalThreadState {
  const tracked = useTrackedSidebarEntry(threadId);
  const held = tracked?.held === true ? tracked.entry : null;
  const query = useThread(held === null ? threadId : "");
  const read = readThread(threadId, tracked, query);
  switch (read.status) {
    case "ready":
      return stateOf(read.thread);
    case "loading":
      return LOADING;
    case "notFound":
      return NOT_FOUND;
    case "error":
      return ERROR;
  }
}
