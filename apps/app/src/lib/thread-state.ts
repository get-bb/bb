import { useMemo, useSyncExternalStore } from "react";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  ExperimentalThread,
  ExperimentalThreadState,
} from "@get-bb/plugin-sdk";
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

export function useThreadState(threadId: string): ExperimentalThreadState {
  const tracked = useTrackedSidebarEntry(threadId);
  const held = tracked?.held === true ? tracked.entry : null;
  const query = useThread(held === null ? threadId : "");
  if (threadId === "") return NOT_FOUND;
  if (held !== null) return stateOf(held);
  if (query.error instanceof BbHttpError && query.error.status === 404) {
    return NOT_FOUND;
  }
  if (query.data !== undefined) return stateOf(query.data);
  if (query.error !== null) return ERROR;
  return tracked === null ? LOADING : stateOf(tracked.entry);
}
