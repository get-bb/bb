import { useCallback, useContext, useSyncExternalStore } from "react";
import {
  notifyManager,
  QueryClientContext,
  type QueryCacheNotifyEvent,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  ThreadOriginKind,
  ThreadVisibility,
  ThreadWithRuntime,
} from "@bb/domain";
import {
  allThreadQueryKeyPrefix,
  SIDEBAR_NAVIGATION_QUERY_KEY,
  THREAD_QUERY_KEY,
  THREADS_QUERY_KEY,
  threadsQueryKey,
} from "@/hooks/queries/query-keys";
import { getCachedSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import {
  getCachedThreadLists,
  iterateThreadListCacheEntries,
} from "@/hooks/cache-owners/thread-list-cache-data";

export interface SenderThreadMetadata {
  projectId: string;
  title: string | null;
  originKind: ThreadOriginKind | null;
  originPluginId: string | null;
  visibility: ThreadVisibility | null;
}

interface SenderThreadTitleSource {
  title: string | null;
  titleFallback: string | null;
}

interface SenderThreadMetadataSource extends SenderThreadTitleSource {
  id: string;
  projectId: string;
  originKind: ThreadOriginKind | null;
  originPluginId: string | null;
  visibility: ThreadVisibility;
}

function senderThreadTitle(source: SenderThreadTitleSource): string | null {
  const title = source.title?.trim();
  if (title) {
    return title;
  }
  const titleFallback = source.titleFallback?.trim();
  return titleFallback || null;
}

function addSenderThreadMetadata(
  metadataById: Map<string, SenderThreadMetadata>,
  thread: SenderThreadMetadataSource,
): void {
  const title = senderThreadTitle(thread);
  const existing = metadataById.get(thread.id);
  if (existing && (existing.title !== null || title === null)) {
    return;
  }
  metadataById.set(thread.id, {
    projectId: thread.projectId,
    title,
    originKind: thread.originKind,
    originPluginId: thread.originPluginId,
    visibility: thread.visibility,
  });
}

function buildSenderThreadMetadataById(
  queryClient: QueryClient | null,
): ReadonlyMap<string, SenderThreadMetadata> {
  const metadataById = new Map<string, SenderThreadMetadata>();
  if (queryClient === null) {
    return metadataById;
  }

  for (const thread of getCachedSidebarNavigationThreads(queryClient)) {
    addSenderThreadMetadata(metadataById, thread);
  }

  for (const [, thread] of queryClient.getQueriesData<ThreadWithRuntime>({
    queryKey: allThreadQueryKeyPrefix(),
  })) {
    if (thread) {
      addSenderThreadMetadata(metadataById, thread);
    }
  }

  for (const cachedList of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(cachedList.data)) {
      addSenderThreadMetadata(metadataById, thread);
    }
  }

  return metadataById;
}

function shouldSyncSenderThreadMetadata(event: QueryCacheNotifyEvent): boolean {
  return (
    event.type === "updated" &&
    (event.query.queryKey[0] === SIDEBAR_NAVIGATION_QUERY_KEY ||
      event.query.queryKey[0] === THREADS_QUERY_KEY ||
      event.query.queryKey[0] === THREAD_QUERY_KEY)
  );
}

function areSenderThreadMetadataEntriesEqual(
  left: SenderThreadMetadata,
  right: SenderThreadMetadata,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.originKind === right.originKind &&
    left.originPluginId === right.originPluginId &&
    left.visibility === right.visibility
  );
}

function mergeSenderThreadMetadata(
  current: ReadonlyMap<string, SenderThreadMetadata>,
  next: ReadonlyMap<string, SenderThreadMetadata>,
): ReadonlyMap<string, SenderThreadMetadata> {
  let changed = current.size !== next.size;
  const merged = new Map<string, SenderThreadMetadata>();
  for (const [threadId, entry] of next) {
    const previous = current.get(threadId);
    if (
      previous !== undefined &&
      areSenderThreadMetadataEntriesEqual(previous, entry)
    ) {
      merged.set(threadId, previous);
    } else {
      merged.set(threadId, entry);
      changed = true;
    }
  }
  return changed ? merged : current;
}

interface SenderThreadMetadataStore {
  getSnapshot(): ReadonlyMap<string, SenderThreadMetadata>;
  subscribe(listener: () => void): () => void;
}

const EMPTY_SENDER_THREAD_METADATA: ReadonlyMap<string, SenderThreadMetadata> =
  new Map();

const NO_SENDER_THREAD_METADATA_STORE: SenderThreadMetadataStore = {
  getSnapshot: () => EMPTY_SENDER_THREAD_METADATA,
  subscribe: () => () => {},
};

function createSenderThreadMetadataStore(
  queryClient: QueryClient,
): SenderThreadMetadataStore {
  let metadataById = buildSenderThreadMetadataById(queryClient);
  let notifiedMetadataById = metadataById;
  let stale = false;
  const listeners = new Set<() => void>();
  const getSnapshot = () => {
    if (stale) {
      stale = false;
      metadataById = mergeSenderThreadMetadata(
        metadataById,
        buildSenderThreadMetadataById(queryClient),
      );
    }
    return metadataById;
  };
  const sync = () => {
    if (listeners.size === 0) return;
    const next = getSnapshot();
    if (next === notifiedMetadataById) return;
    notifiedMetadataById = next;
    for (const listener of [...listeners]) listener();
  };
  queryClient.getQueryCache().subscribe((event) => {
    if (shouldSyncSenderThreadMetadata(event)) {
      stale = true;
      notifyManager.schedule(sync);
    }
  });
  return {
    getSnapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const senderThreadMetadataStores = new WeakMap<
  QueryClient,
  SenderThreadMetadataStore
>();

function useSenderThreadMetadataStore(): SenderThreadMetadataStore {
  const queryClient = useContext(QueryClientContext) ?? null;
  if (queryClient === null) return NO_SENDER_THREAD_METADATA_STORE;
  let store = senderThreadMetadataStores.get(queryClient);
  if (store === undefined) {
    store = createSenderThreadMetadataStore(queryClient);
    senderThreadMetadataStores.set(queryClient, store);
  }
  return store;
}

export function useSenderThreadMetadataById(): ReadonlyMap<
  string,
  SenderThreadMetadata
> {
  const store = useSenderThreadMetadataStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

export function useSenderThreadMetadata(
  threadId: string | null,
): SenderThreadMetadata | null {
  const store = useSenderThreadMetadataStore();
  const getEntry = useCallback(
    () =>
      threadId === null ? null : (store.getSnapshot().get(threadId) ?? null),
    [store, threadId],
  );
  return useSyncExternalStore(store.subscribe, getEntry, getEntry);
}
