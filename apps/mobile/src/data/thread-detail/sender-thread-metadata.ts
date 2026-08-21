import type {
  ThreadOriginKind,
  ThreadVisibility,
  ThreadWithRuntime,
} from "@bb/domain";
import type { QueryCacheNotifyEvent, QueryClient } from "@tanstack/react-query";
import {
  allThreadQueryKeyPrefix,
  SIDEBAR_NAVIGATION_QUERY_KEY,
  THREAD_QUERY_KEY,
  THREADS_QUERY_KEY,
} from "@/lib/query/query-keys";
import {
  getCachedSidebarThreads,
  getCachedThreadLists,
  iterateThreadListCacheEntries,
} from "../threads/thread-list-cache";

/**
 * What a generated ("Message from …") conversation row needs to know about
 * the thread that sent it, resolved from thread data already held in the
 * query cache (mirrors apps/app/src/hooks/useSenderThreadMetadataById.ts).
 * No request is issued per sender: the sidebar bootstrap, the live thread
 * caches, and the child-thread lists already cover the threads a message can
 * come from.
 */
export interface SenderThreadMetadata {
  title: string | null;
  originKind: ThreadOriginKind | null;
  originPluginId: string | null;
  visibility: ThreadVisibility | null;
}

interface SenderThreadMetadataSource {
  id: string;
  title: string | null;
  titleFallback: string | null;
  originKind: ThreadOriginKind | null;
  originPluginId: string | null;
  visibility: ThreadVisibility;
}

/** Id of the builtin side-chat plugin (plugins/side-chat). */
export const SIDE_CHAT_PLUGIN_ID = "side-chat";

function senderThreadTitle(
  source: Pick<SenderThreadMetadataSource, "title" | "titleFallback">,
): string | null {
  const title = source.title?.trim();
  if (title) return title;
  const titleFallback = source.titleFallback?.trim();
  return titleFallback || null;
}

function addSenderThreadMetadata(
  metadataById: Map<string, SenderThreadMetadata>,
  thread: SenderThreadMetadataSource,
): void {
  const title = senderThreadTitle(thread);
  const existing = metadataById.get(thread.id);
  // A later, less specific source never downgrades a known title.
  if (existing && (existing.title !== null || title === null)) return;
  metadataById.set(thread.id, {
    title,
    originKind: thread.originKind,
    originPluginId: thread.originPluginId,
    visibility: thread.visibility,
  });
}

/**
 * Sidebar first (actively observed and refetched on title changes), then the
 * single-thread caches, then any thread list (child lists, archived pages).
 */
export function buildSenderThreadMetadataById(
  queryClient: QueryClient,
): ReadonlyMap<string, SenderThreadMetadata> {
  const metadataById = new Map<string, SenderThreadMetadata>();
  for (const thread of getCachedSidebarThreads(queryClient)) {
    addSenderThreadMetadata(metadataById, thread);
  }
  for (const [, thread] of queryClient.getQueriesData<ThreadWithRuntime>({
    queryKey: allThreadQueryKeyPrefix(),
  })) {
    if (thread) addSenderThreadMetadata(metadataById, thread);
  }
  for (const { data } of getCachedThreadLists(queryClient)) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      addSenderThreadMetadata(metadataById, thread);
    }
  }
  return metadataById;
}

/**
 * Only "updated" dispatches change `query.state.data`; observer churn fires
 * other events without a data change and would only rebuild equal maps.
 */
function shouldSyncSenderThreadMetadata(event: QueryCacheNotifyEvent): boolean {
  if (event.type !== "updated") return false;
  const root = event.query.queryKey[0];
  return (
    root === SIDEBAR_NAVIGATION_QUERY_KEY ||
    root === THREADS_QUERY_KEY ||
    root === THREAD_QUERY_KEY
  );
}

function areSenderThreadMetadataEntriesEqual(
  left: SenderThreadMetadata,
  right: SenderThreadMetadata,
): boolean {
  return (
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
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [threadId, entry] of left) {
    const other = right.get(threadId);
    if (other === undefined) return false;
    if (!areSenderThreadMetadataEntriesEqual(entry, other)) return false;
  }
  return true;
}

export interface SenderThreadMetadataStore {
  /** `useSyncExternalStore` subscribe: listeners fire only when the map changed. */
  subscribe(listener: () => void): () => void;
  /** Stable reference until a relevant cache update changes the content. */
  getSnapshot(): ReadonlyMap<string, SenderThreadMetadata>;
}

/**
 * External-store view of the sender metadata: rebuilt (coalesced to one
 * rebuild per microtask) on relevant query-cache updates, and published only
 * when the rebuilt map is not value-equal to the current one, so the whole
 * timeline does not re-render on unrelated cache traffic.
 */
export function createSenderThreadMetadataStore(
  queryClient: QueryClient,
  scheduleRebuild: (run: () => void) => void = (run) => queueMicrotask(run),
): SenderThreadMetadataStore {
  let current = buildSenderThreadMetadataById(queryClient);
  const listeners = new Set<() => void>();
  let rebuildPending = false;
  let unsubscribeCache: (() => void) | null = null;

  const rebuild = () => {
    rebuildPending = false;
    if (listeners.size === 0) return;
    const next = buildSenderThreadMetadataById(queryClient);
    if (areSenderThreadMetadataMapsEqual(current, next)) return;
    current = next;
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (unsubscribeCache === null) {
        unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
          if (!shouldSyncSenderThreadMetadata(event) || rebuildPending) return;
          rebuildPending = true;
          scheduleRebuild(rebuild);
        });
        // Catch up on anything that landed while nobody was listening.
        rebuildPending = true;
        scheduleRebuild(rebuild);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unsubscribeCache !== null) {
          unsubscribeCache();
          unsubscribeCache = null;
        }
      };
    },
    getSnapshot: () => current,
  };
}

/**
 * Whether a sender thread is one of the side-chat plugin's hidden forks
 * (promoted forks become visible and read as ordinary named threads).
 */
export function isPluginSideChatSenderThread(
  metadata: SenderThreadMetadata | null,
): boolean {
  return (
    metadata !== null &&
    metadata.originKind === "fork" &&
    metadata.originPluginId === SIDE_CHAT_PLUGIN_ID &&
    metadata.visibility === "hidden"
  );
}
