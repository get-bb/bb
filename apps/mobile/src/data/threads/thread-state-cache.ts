import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type { QueryClient } from "@tanstack/react-query";
import {
  projectsQueryKey,
  sidebarNavigationQueryKey,
  threadDetailBootstrapQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadSearchQueryKeyPrefix,
  threadTimelineQueryKey,
  threadsQueryKey,
} from "@/lib/query/query-keys";
import {
  applyToCachedThreadListsAndSidebar,
  getCachedSidebarThreads,
  getCachedThreadLists,
  iterateThreadListCacheEntries,
  restoreThreadListCaches,
  snapshotThreadListCaches,
  type ThreadListCacheSnapshot,
} from "./thread-list-cache";

/**
 * Optimistic thread-state transactions (mirrors
 * apps/app/src/hooks/cache-owners/thread-state-cache-owner.ts). Every
 * transaction snapshots the single-thread query plus every cached list and
 * the sidebar bootstrap, applies the optimistic patch, and returns what the
 * mutation's `onError` needs to roll back. `settle*` invalidates the lists so
 * the server's ordering wins once the request finishes.
 */

export interface ThreadListMutationTransaction {
  previousThread: ThreadWithRuntime | undefined;
  previousLists: ThreadListCacheSnapshot;
}

export interface ArchiveThreadsTransaction {
  archivedThreadIds: string[];
  previousLists: ThreadListCacheSnapshot;
  previousThreads: { id: string; thread: ThreadWithRuntime | undefined }[];
}

interface ThreadIdArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface OptimisticThreadPatchArgs extends ThreadIdArgs {
  /** Patch applied to the cached single-thread response (when present). */
  patchThread: (thread: ThreadWithRuntime) => ThreadWithRuntime;
  /** Patch applied to the matching entry in every list and the sidebar. */
  patchEntry: (entry: ThreadListEntry) => ThreadListEntry | null;
}

async function cancelThreadListQueries(
  queryClient: QueryClient,
  threadId?: string,
): Promise<void> {
  if (threadId !== undefined) {
    await queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) });
  }
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
  await queryClient.cancelQueries({ queryKey: sidebarNavigationQueryKey() });
}

/**
 * Generic optimistic patch. `patchEntry` returning null removes the entry
 * from lists (unarchive from the archived list, delete, archive).
 */
async function beginOptimisticThreadPatch({
  patchEntry,
  patchThread,
  queryClient,
  threadId,
}: OptimisticThreadPatchArgs): Promise<ThreadListMutationTransaction> {
  await cancelThreadListQueries(queryClient, threadId);
  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousLists = snapshotThreadListCaches(queryClient);
  queryClient.setQueryData<ThreadWithRuntime>(threadQueryKey(threadId), (t) =>
    t === undefined ? t : patchThread(t),
  );
  applyToCachedThreadListsAndSidebar(queryClient, (list) =>
    list.flatMap((entry) => {
      if (entry.id !== threadId) return [entry];
      const patched = patchEntry(entry);
      return patched === null ? [] : [patched];
    }),
  );
  return { previousThread, previousLists };
}

export function rollbackThreadListMutation(
  { queryClient, threadId }: ThreadIdArgs,
  transaction: ThreadListMutationTransaction | undefined,
): void {
  if (!transaction) return;
  queryClient.setQueryData(
    threadQueryKey(threadId),
    transaction.previousThread,
  );
  restoreThreadListCaches(queryClient, transaction.previousLists);
}

/** After a list-membership mutation settles, let the server ordering win. */
export function invalidateThreadLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  void queryClient.invalidateQueries({
    queryKey: threadSearchQueryKeyPrefix(),
  });
}

export function invalidateThreadDetail(
  queryClient: QueryClient,
  threadId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
}

/** Write the server's thread back into the detail cache and every list row. */
export function applyThreadResult(
  queryClient: QueryClient,
  thread: ThreadWithRuntime,
): void {
  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(thread.id),
    thread,
  );
  applyToCachedThreadListsAndSidebar(queryClient, (list) =>
    list.map((entry) =>
      entry.id === thread.id ? { ...entry, ...thread } : entry,
    ),
  );
}

// --- Pin ---------------------------------------------------------------

export function beginPinThreadTransaction(
  args: ThreadIdArgs & { pinnedAt: number },
): Promise<ThreadListMutationTransaction> {
  return beginOptimisticThreadPatch({
    ...args,
    patchThread: (thread) => ({ ...thread, pinnedAt: args.pinnedAt }),
    patchEntry: (entry) => ({
      ...entry,
      pinnedAt: args.pinnedAt,
      pinSortKey: null,
    }),
  });
}

export function beginUnpinThreadTransaction(
  args: ThreadIdArgs,
): Promise<ThreadListMutationTransaction> {
  return beginOptimisticThreadPatch({
    ...args,
    patchThread: (thread) => ({ ...thread, pinnedAt: null }),
    patchEntry: (entry) => ({ ...entry, pinnedAt: null, pinSortKey: null }),
  });
}

/** Pin/unpin responses carry no `pinSortKey`; the server sorts on refetch. */
export function applyThreadPinStateResult(
  queryClient: QueryClient,
  thread: ThreadWithRuntime,
): void {
  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(thread.id),
    thread,
  );
  applyToCachedThreadListsAndSidebar(queryClient, (list) =>
    list.map((entry) =>
      entry.id === thread.id
        ? { ...entry, ...thread, pinSortKey: null }
        : entry,
    ),
  );
}

// --- Read state ---------------------------------------------------------

function optimisticLastReadAt(
  thread: Pick<ThreadWithRuntime, "latestAttentionAt">,
  lastReadAt: number | null,
): number | null {
  if (lastReadAt === null) return null;
  return Math.max(lastReadAt, thread.latestAttentionAt);
}

export function beginThreadReadStateTransaction(
  args: ThreadIdArgs & { lastReadAt: number | null },
): Promise<ThreadListMutationTransaction> {
  const patch = <T extends Pick<ThreadWithRuntime, "latestAttentionAt">>(
    thread: T,
  ): T => ({
    ...thread,
    lastReadAt: optimisticLastReadAt(thread, args.lastReadAt),
  });
  return beginOptimisticThreadPatch({
    ...args,
    patchThread: patch,
    patchEntry: patch,
  });
}

// --- Metadata (title, section) -----------------------------------------

export interface ThreadMetadataPatch {
  title?: string | null;
  sectionId?: string | null;
}

export function beginThreadMetadataTransaction(
  args: ThreadIdArgs & ThreadMetadataPatch,
): Promise<ThreadListMutationTransaction> {
  const patch = {
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.sectionId !== undefined ? { sectionId: args.sectionId } : {}),
  };
  return beginOptimisticThreadPatch({
    queryClient: args.queryClient,
    threadId: args.threadId,
    patchThread: (thread) => ({ ...thread, ...patch }),
    patchEntry: (entry) => ({ ...entry, ...patch }),
  });
}

// --- Archive / unarchive -----------------------------------------------

/**
 * Archive a thread and its live children: they leave every live list and
 * the sidebar immediately; their detail caches gain `archivedAt`.
 */
export async function beginArchiveThreadAndChildrenTransaction({
  queryClient,
  threadId,
}: ThreadIdArgs): Promise<ArchiveThreadsTransaction> {
  await cancelThreadListQueries(queryClient);
  const matches = (thread: Pick<ThreadListEntry, "id" | "parentThreadId">) =>
    thread.id === threadId || thread.parentThreadId === threadId;
  const archivedThreadIds = new Set<string>([threadId]);
  for (const entry of getCachedSidebarThreads(queryClient)) {
    if (matches(entry) && entry.archivedAt === null) {
      archivedThreadIds.add(entry.id);
    }
  }
  for (const { data } of getCachedThreadLists(queryClient)) {
    for (const entry of iterateThreadListCacheEntries(data)) {
      if (matches(entry) && entry.archivedAt === null) {
        archivedThreadIds.add(entry.id);
      }
    }
  }
  const ids = Array.from(archivedThreadIds);
  await Promise.all(
    ids.map((id) =>
      queryClient.cancelQueries({ queryKey: threadQueryKey(id) }),
    ),
  );
  const previousLists = snapshotThreadListCaches(queryClient);
  const previousThreads = ids.map((id) => ({
    id,
    thread: queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(id)),
  }));
  const archivedAt = Date.now();
  for (const id of ids) {
    queryClient.setQueryData<ThreadWithRuntime>(threadQueryKey(id), (t) =>
      t === undefined || t.archivedAt !== null ? t : { ...t, archivedAt },
    );
  }
  applyToCachedThreadListsAndSidebar(queryClient, (list) =>
    list.filter(
      (entry) =>
        !(archivedThreadIds.has(entry.id) && entry.archivedAt === null),
    ),
  );
  return { archivedThreadIds: ids, previousLists, previousThreads };
}

export function rollbackArchiveThreadsTransaction(
  queryClient: QueryClient,
  transaction: ArchiveThreadsTransaction | undefined,
): void {
  if (!transaction) return;
  restoreThreadListCaches(queryClient, transaction.previousLists);
  for (const { id, thread } of transaction.previousThreads) {
    queryClient.setQueryData(threadQueryKey(id), thread);
  }
}

export function settleArchiveThreadsTransaction(
  queryClient: QueryClient,
  archivedThreadIds: readonly string[],
): void {
  invalidateThreadLists(queryClient);
  for (const id of archivedThreadIds) invalidateThreadDetail(queryClient, id);
}

/** Unarchive: the row leaves the archived list; the detail loses `archivedAt`. */
export function beginUnarchiveThreadTransaction(
  args: ThreadIdArgs,
): Promise<ThreadListMutationTransaction> {
  return beginOptimisticThreadPatch({
    ...args,
    patchThread: (thread) => ({ ...thread, archivedAt: null }),
    patchEntry: () => null,
  });
}

// --- Delete -------------------------------------------------------------

function removeThreadScopedQueries(
  queryClient: QueryClient,
  threadId: string,
): void {
  queryClient.removeQueries({ queryKey: threadQueryKey(threadId) });
  queryClient.removeQueries({
    queryKey: threadDetailBootstrapQueryKey(threadId),
  });
  queryClient.removeQueries({ queryKey: threadTimelineQueryKey(threadId) });
  queryClient.removeQueries({
    queryKey: threadPendingInteractionsQueryKey(threadId),
  });
  queryClient.removeQueries({
    queryKey: threadQueuedMessagesQueryKey(threadId),
  });
}

export async function beginDeleteThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdArgs): Promise<ThreadListMutationTransaction> {
  await cancelThreadListQueries(queryClient, threadId);
  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousLists = snapshotThreadListCaches(queryClient);
  removeThreadScopedQueries(queryClient, threadId);
  applyToCachedThreadListsAndSidebar(queryClient, (list) =>
    list.filter((entry) => entry.id !== threadId),
  );
  return { previousThread, previousLists };
}

export function settleDeleteThreadTransaction(
  queryClient: QueryClient,
  threadId: string,
): void {
  removeThreadScopedQueries(queryClient, threadId);
  invalidateThreadLists(queryClient);
  void queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
}
