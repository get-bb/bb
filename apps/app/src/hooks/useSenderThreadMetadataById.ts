import { useContext, useEffect, useState } from "react";
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

  // Prefer the sidebar snapshot for visible threads. It is actively observed
  // and refetched after title changes, while broader thread-list caches can be
  // present but inactive and therefore retain an older non-null title.
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
  // The map is built from `query.state.data`, which only changes through
  // "updated" dispatches. "observerResultsUpdated" fires on observer churn
  // (subscription changes, tracked-prop recomputes) without a data change, so
  // reacting to it would only rebuild identical maps.
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

function areSenderThreadMetadataMapsEqual(
  left: ReadonlyMap<string, SenderThreadMetadata>,
  right: ReadonlyMap<string, SenderThreadMetadata>,
): boolean {
  if (left === right) {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const [threadId, entry] of left) {
    const other = right.get(threadId);
    if (other === undefined) {
      return false;
    }
    if (!areSenderThreadMetadataEntriesEqual(entry, other)) {
      return false;
    }
  }
  return true;
}

/**
 * Resolves agent-message source titles from thread data already held in React
 * Query. Both the timeline and its table of contents use this so their source
 * labels stay in sync without issuing one request per sender thread.
 */
export function useSenderThreadMetadataById(): ReadonlyMap<
  string,
  SenderThreadMetadata
> {
  const queryClient = useContext(QueryClientContext) ?? null;
  const [metadataById, setMetadataById] = useState(() =>
    buildSenderThreadMetadataById(queryClient),
  );

  useEffect(() => {
    if (queryClient === null) {
      return;
    }

    let subscribed = true;
    const syncMetadataById = () => {
      if (subscribed) {
        // QueryClient has stable identity while the data inside its cache is
        // mutable. Store the rebuilt map itself so consumers receive a new
        // state value instead of relying on render-time reads of that object.
        // Keep the previous map when the rebuild is value-equal: the timeline
        // feeds this map into context, so a fresh-but-equal reference would
        // re-render every row on every matching cache event.
        setMetadataById((current) => {
          const next = buildSenderThreadMetadataById(queryClient);
          return areSenderThreadMetadataMapsEqual(current, next)
            ? current
            : next;
        });
      }
    };
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (shouldSyncSenderThreadMetadata(event)) {
        notifyManager.schedule(syncMetadataById);
      }
    });

    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, [queryClient]);

  return metadataById;
}
