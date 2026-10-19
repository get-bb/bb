import { cancelOptimisticQueries } from "./optimistic-query-cancellation";
import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  UpdateThreadRequest,
  ThreadArchiveAllResponse,
} from "@bb/server-contract";
import {
  sidebarNavigationQueryKey,
  threadQueryKey,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
} from "../queries/query-keys";
import { removeEnvironmentScopedQueries } from "./environment-cache-effects";
import {
  invalidateThreadDeleteQueries,
  invalidateThreadListMembershipQueries,
  invalidateThreadListQueries,
  removeThreadScopedQueries,
} from "./mutation-cache-effects";
import {
  applyToCachedThreadListsAndSidebarNavigation,
  applyToCachedSidebarNavigationThreads,
  listSidebarNavigationThreads,
  getCachedSidebarNavigationThreads,
  snapshotCachedSidebarNavigation,
  type CachedSidebarNavigationSnapshot,
} from "./query-cache";
import {
  applyToCachedThreadLists,
  getCachedThreadLists,
  iterateThreadListCacheEntries,
  restoreCachedThreadLists,
  restoreRemovedThreadEntries,
  type CachedThreadListSnapshot,
  type ThreadListCacheData,
} from "./thread-list-cache-data";
import {
  getCachedLiveThreadIdsMatching,
  getCachedThreadSnapshots,
  optimisticallyArchiveThreads,
  removeLiveThreadsFromCachedLists,
  type CachedThreadSnapshot,
} from "./thread-archive-cache";
import {
  applyThreadPatches,
  holdPendingThreadPatches,
  type ThreadMetadataPatch,
} from "./pending-thread-patches";

interface ThreadIdCacheArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface ThreadRuntimeCacheArgs {
  queryClient: QueryClient;
  thread: ThreadWithRuntime;
}

interface ThreadPinSuccessArgs extends ThreadRuntimeCacheArgs {
  pinSortKey: string | null;
}

interface BeginThreadPinTransactionArgs extends ThreadIdCacheArgs {
  pinnedAt: number;
}

interface BeginThreadReadStateTransactionArgs extends ThreadIdCacheArgs {
  lastReadAt: number | null;
}

interface BeginThreadMetadataTransactionArgs extends ThreadIdCacheArgs {
  parentThreadId?: string | null;
  sectionId?: string | null;
  title?: string | null;
}

interface ThreadMetadataUpdate {
  threadId: string;
  parentThreadId?: string | null;
  sectionId?: string | null;
  title?: string | null;
  pinnedAt?: number | null;
}

interface BeginThreadMetadataBatchTransactionArgs {
  queryClient: QueryClient;
  updates: readonly ThreadMetadataUpdate[];
}

interface RollbackThreadListMutationTransactionArgs extends ThreadIdCacheArgs {
  transaction: ThreadListMutationTransaction | undefined;
}

interface ArchiveThreadAndChildrenTransactionArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface ArchiveMatchingThreadsTransactionArgs {
  matchesThread: (thread: ThreadListEntry) => boolean;
  queryClient: QueryClient;
}

interface RollbackArchiveThreadsTransactionArgs {
  queryClient: QueryClient;
  transaction: ArchiveThreadsTransaction | undefined;
}

interface SettleArchiveThreadsTransactionArgs {
  queryClient: QueryClient;
  response: ThreadArchiveAllResponse | undefined;
  transaction: ArchiveThreadsTransaction | undefined;
}

interface RollbackDeleteThreadTransactionArgs {
  queryClient: QueryClient;
  transaction: DeleteThreadTransaction | undefined;
}

interface SettleDeleteThreadTransactionArgs extends ThreadIdCacheArgs {
  transaction: DeleteThreadTransaction | undefined;
}

export interface ThreadListMutationTransaction {
  rollbackFields: () => void;
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThread: ThreadWithRuntime | undefined;
  previousThreadLists: CachedThreadListSnapshot;
  releasePendingPatches: () => void;
}

interface ThreadMetadataBatchTransaction {
  rollbackFields: () => void;
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThreads: ReadonlyMap<string, ThreadWithRuntime | undefined>;
  previousThreadLists: CachedThreadListSnapshot;
  releasePendingPatches: () => void;
}

export interface ArchiveThreadsTransaction {
  archivedThreadIds: string[];
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThreadLists: CachedThreadListSnapshot;
  previousThreads: CachedThreadSnapshot[];
}

export interface DeleteThreadTransaction {
  environmentId: string | null | undefined;
  threadIds: string[];
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
  previousThreads: CachedThreadSnapshot[];
  previousThreadLists: CachedThreadListSnapshot;
}

function removeThreadFromLists(queryClient: QueryClient, id: string): void {
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
    list.filter((thread) => thread.id !== id),
  );
}

function getOptimisticLastReadAt(
  thread: Pick<ThreadWithRuntime, "latestAttentionAt">,
  lastReadAt: number | null,
): number | null {
  if (lastReadAt === null) {
    return null;
  }
  return Math.max(lastReadAt, thread.latestAttentionAt);
}

function responseMetadataPatch(
  thread: ThreadWithRuntime,
  request: UpdateThreadRequest & { pinnedAt?: number | null },
): ThreadMetadataPatch {
  return {
    ...(request.title !== undefined ? { title: thread.title } : {}),
    ...(request.sectionId !== undefined || request.parentThreadId !== undefined
      ? { sectionId: thread.sectionId }
      : {}),
    ...(request.parentThreadId !== undefined
      ? { parentThreadId: thread.parentThreadId }
      : {}),
    ...(request.visibility !== undefined
      ? { visibility: thread.visibility }
      : {}),
    ...(request.pinnedAt !== undefined
      ? { pinnedAt: thread.pinnedAt, pinSortKey: null }
      : {}),
  };
}

export function applyThreadUpdateResult({
  queryClient,
  thread,
  request,
}: ThreadRuntimeCacheArgs & { request: UpdateThreadRequest }): void {
  applyThreadPatches(
    queryClient,
    new Map([[thread.id, responseMetadataPatch(thread, request)]]),
  );
  invalidateThreadListQueries({ queryClient });
}

type MutableThreadFields = Pick<
  ThreadWithRuntime,
  | "title"
  | "sectionId"
  | "parentThreadId"
  | "pinnedAt"
  | "archivedAt"
  | "lastReadAt"
> & { pinSortKey?: string | null };

function restoreChangedFields<T extends MutableThreadFields>(
  current: T,
  previous: MutableThreadFields | undefined,
  optimistic: MutableThreadFields | undefined,
): T {
  if (!previous || !optimistic) return current;
  const patch: Partial<MutableThreadFields> = {};
  const restore = <K extends keyof MutableThreadFields>(key: K) => {
    if (previous[key] !== optimistic[key] && current[key] === optimistic[key]) {
      patch[key] = previous[key];
    }
  };
  restore("title");
  restore("sectionId");
  restore("parentThreadId");
  restore("pinnedAt");
  restore("pinSortKey");
  restore("archivedAt");
  restore("lastReadAt");
  return { ...current, ...patch };
}

function captureFieldRollback(
  queryClient: QueryClient,
  threadIds: readonly string[],
  previousThreads: ReadonlyMap<string, ThreadWithRuntime | undefined>,
  previousThreadLists: CachedThreadListSnapshot,
  previousSidebarNavigation: CachedSidebarNavigationSnapshot,
): () => void {
  const optimisticThreads = new Map(
    threadIds.map((id) => [
      id,
      queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(id)),
    ]),
  );
  const optimisticLists = previousThreadLists.map(({ queryKey }) =>
    queryClient.getQueryData<ThreadListCacheData>(queryKey),
  );
  const optimisticSidebar = getCachedSidebarNavigationThreads(queryClient);
  return () => {
    for (const id of threadIds) {
      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey(id),
        (current) =>
          current &&
          restoreChangedFields(
            current,
            previousThreads.get(id),
            optimisticThreads.get(id),
          ),
      );
    }
    for (const [index, snapshot] of previousThreadLists.entries()) {
      const previous = new Map(
        [...iterateThreadListCacheEntries(snapshot.data)].map((thread) => [
          thread.id,
          thread,
        ]),
      );
      const optimistic = new Map(
        [...iterateThreadListCacheEntries(optimisticLists[index])].map(
          (thread) => [thread.id, thread],
        ),
      );
      applyToCachedThreadLists(queryClient, {
        queryKey: snapshot.queryKey,
        mapper: (list) =>
          list.map((thread) =>
            threadIds.includes(thread.id)
              ? restoreChangedFields(
                  thread,
                  previous.get(thread.id),
                  optimistic.get(thread.id),
                )
              : thread,
          ),
      });
    }
    const previous = new Map(
      (previousSidebarNavigation
        ? listSidebarNavigationThreads(previousSidebarNavigation)
        : []
      ).map((thread) => [thread.id, thread]),
    );
    const optimistic = new Map(
      optimisticSidebar.map((thread) => [thread.id, thread]),
    );
    applyToCachedSidebarNavigationThreads({
      queryClient,
      mapper: (list) =>
        list.map((thread) =>
          threadIds.includes(thread.id)
            ? restoreChangedFields(
                thread,
                previous.get(thread.id),
                optimistic.get(thread.id),
              )
            : thread,
        ),
    });
  };
}

interface OptimisticThreadFieldTransactionArgs extends ThreadIdCacheArgs {
  patch?: Partial<ThreadWithRuntime>;
  patchThread?: (thread: ThreadWithRuntime) => ThreadWithRuntime;
  applyToLists: (queryClient: QueryClient, threadId: string) => void;
}

async function runOptimisticThreadFieldTransaction({
  applyToLists,
  patch,
  patchThread,
  queryClient,
  threadId,
}: OptimisticThreadFieldTransactionArgs): Promise<ThreadListMutationTransaction> {
  await cancelOptimisticQueries(queryClient, {
    queryKey: threadQueryKey(threadId),
  });
  await cancelOptimisticQueries(queryClient, { queryKey: threadsQueryKey() });
  await cancelOptimisticQueries(queryClient, {
    queryKey: sidebarNavigationQueryKey(),
  });

  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const previousSidebarNavigation =
    snapshotCachedSidebarNavigation(queryClient);

  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
    (thread) => {
      if (!thread) {
        return thread;
      }

      if (patchThread) {
        return patchThread(thread);
      }

      return {
        ...thread,
        ...(patch ?? {}),
      };
    },
  );
  applyToLists(queryClient, threadId);

  return {
    rollbackFields: captureFieldRollback(
      queryClient,
      [threadId],
      new Map([[threadId, previousThread]]),
      previousThreadLists,
      previousSidebarNavigation,
    ),
    previousSidebarNavigation,
    previousThread,
    previousThreadLists,
    releasePendingPatches: () => {},
  };
}

async function beginHeldThreadPatchTransaction({
  patch,
  queryClient,
  threadId,
}: ThreadIdCacheArgs & {
  patch: ThreadMetadataPatch;
}): Promise<ThreadListMutationTransaction> {
  const patches = new Map([[threadId, patch]]);
  const transaction = await runOptimisticThreadFieldTransaction({
    applyToLists: (queryClient) => applyThreadPatches(queryClient, patches),
    queryClient,
    threadId,
  });
  return {
    ...transaction,
    releasePendingPatches: holdPendingThreadPatches(queryClient, patches),
  };
}

export function settleThreadPatchTransaction(
  transaction: ThreadListMutationTransaction | undefined,
): void {
  transaction?.releasePendingPatches();
}

export function beginPinThreadTransaction({
  pinnedAt,
  queryClient,
  threadId,
}: BeginThreadPinTransactionArgs): Promise<ThreadListMutationTransaction> {
  return beginHeldThreadPatchTransaction({
    patch: { pinnedAt, pinSortKey: null },
    queryClient,
    threadId,
  });
}

export function beginUnpinThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<ThreadListMutationTransaction> {
  return beginHeldThreadPatchTransaction({
    patch: { pinnedAt: null, pinSortKey: null },
    queryClient,
    threadId,
  });
}

export async function beginThreadReadStateTransaction({
  lastReadAt,
  queryClient,
  threadId,
}: BeginThreadReadStateTransactionArgs): Promise<ThreadReadStateTransaction> {
  const transaction = await runOptimisticThreadFieldTransaction({
    applyToLists: (queryClient, threadId) =>
      applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
        list.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                lastReadAt: getOptimisticLastReadAt(thread, lastReadAt),
              }
            : thread,
        ),
      ),
    patchThread: (thread) => ({
      ...thread,
      lastReadAt: getOptimisticLastReadAt(thread, lastReadAt),
    }),
    queryClient,
    threadId,
  });
  return { ...transaction, lastReadAt };
}

export interface ThreadReadStateTransaction extends ThreadListMutationTransaction {
  lastReadAt: number | null;
}

export function rollbackThreadReadStateTransaction({
  transaction,
}: ThreadIdCacheArgs & {
  transaction: ThreadReadStateTransaction | undefined;
}): void {
  transaction?.rollbackFields();
}

function findThreadMetadataInCache(
  queryClient: QueryClient,
  threadId: string,
): Pick<ThreadWithRuntime, "parentThreadId" | "sectionId"> | undefined {
  const thread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  if (thread) return thread;
  const sidebarThread = getCachedSidebarNavigationThreads(queryClient).find(
    (entry) => entry.id === threadId,
  );
  if (sidebarThread) return sidebarThread;
  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const entry of iterateThreadListCacheEntries(data)) {
      if (entry.id === threadId) return entry;
    }
  }
  return undefined;
}

function resolveThreadMetadataPatch({
  pinnedAt,
  parentThreadId,
  sectionId,
  queryClient,
  threadId,
  title,
}: ThreadMetadataUpdate & {
  queryClient: QueryClient;
}): ThreadMetadataPatch {
  if (parentThreadId === null && sectionId === undefined) {
    const thread = findThreadMetadataInCache(queryClient, threadId);
    if (thread?.parentThreadId) {
      const parent = findThreadMetadataInCache(
        queryClient,
        thread.parentThreadId,
      );
      if (parent) {
        sectionId = parent.sectionId;
      } else {
        parentThreadId = undefined;
      }
    }
  }
  return {
    ...(pinnedAt !== undefined ? { pinnedAt, pinSortKey: null } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(sectionId !== undefined ? { sectionId } : {}),
    ...(parentThreadId !== undefined ? { parentThreadId } : {}),
  };
}

export function beginThreadMetadataTransaction({
  parentThreadId,
  sectionId,
  queryClient,
  threadId,
  title,
}: BeginThreadMetadataTransactionArgs): Promise<ThreadListMutationTransaction> {
  const patch = resolveThreadMetadataPatch({
    parentThreadId,
    queryClient,
    sectionId,
    threadId,
    title,
  });
  return beginHeldThreadPatchTransaction({ patch, queryClient, threadId });
}

export async function beginThreadMetadataBatchTransaction({
  queryClient,
  updates,
}: BeginThreadMetadataBatchTransactionArgs): Promise<ThreadMetadataBatchTransaction> {
  const threadIds = [...new Set(updates.map((update) => update.threadId))];
  await Promise.all([
    ...threadIds.map((threadId) =>
      cancelOptimisticQueries(queryClient, {
        queryKey: threadQueryKey(threadId),
      }),
    ),
    cancelOptimisticQueries(queryClient, { queryKey: threadsQueryKey() }),
    cancelOptimisticQueries(queryClient, {
      queryKey: sidebarNavigationQueryKey(),
    }),
  ]);

  const previousThreads = new Map(
    threadIds.map((threadId) => [
      threadId,
      queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId)),
    ]),
  );
  const previousThreadLists = getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const previousSidebarNavigation =
    snapshotCachedSidebarNavigation(queryClient);
  const patches = new Map<string, ThreadMetadataPatch>();
  for (const update of updates) {
    patches.set(update.threadId, {
      ...patches.get(update.threadId),
      ...resolveThreadMetadataPatch({ ...update, queryClient }),
    });
  }

  applyThreadPatches(queryClient, patches);

  return {
    rollbackFields: captureFieldRollback(
      queryClient,
      threadIds,
      previousThreads,
      previousThreadLists,
      previousSidebarNavigation,
    ),
    previousSidebarNavigation,
    previousThreads,
    previousThreadLists,
    releasePendingPatches: holdPendingThreadPatches(queryClient, patches),
  };
}

export function rollbackThreadMetadataBatchTransaction({
  transaction,
}: {
  queryClient: QueryClient;
  transaction: ThreadMetadataBatchTransaction | undefined;
}): void {
  if (!transaction) return;
  transaction.rollbackFields();
}

export function applyThreadMetadataBatchResult({
  queryClient,
  updates,
}: {
  queryClient: QueryClient;
  updates: readonly {
    thread: ThreadWithRuntime;
    request: UpdateThreadRequest & { pinnedAt?: number | null };
  }[];
}): void {
  const patches = new Map<string, ThreadMetadataPatch>();
  for (const { thread, request } of updates) {
    patches.set(thread.id, {
      ...patches.get(thread.id),
      ...responseMetadataPatch(thread, request),
    });
  }
  applyThreadPatches(queryClient, patches);
  invalidateThreadListQueries({ queryClient });
}

export function invalidateThreadMetadataBatch({
  queryClient,
  threadIds,
}: {
  queryClient: QueryClient;
  threadIds: readonly string[];
}): void {
  for (const threadId of threadIds) {
    void queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  }
  invalidateThreadListQueries({ queryClient });
}

export function rollbackThreadListMutationTransaction({
  transaction,
}: RollbackThreadListMutationTransactionArgs): void {
  if (!transaction) {
    return;
  }

  transaction.rollbackFields();
}

export function applyThreadPinStateResult({
  pinSortKey,
  queryClient,
  thread,
}: ThreadPinSuccessArgs): void {
  applyThreadPatches(
    queryClient,
    new Map([[thread.id, { pinnedAt: thread.pinnedAt, pinSortKey }]]),
  );
}

export function applyPinnedThreadOrderResult({
  queryClient,
  orderedRoots,
}: {
  queryClient: QueryClient;
  orderedRoots: readonly ThreadListEntry[];
}): void {
  const rootsById = new Map(orderedRoots.map((thread) => [thread.id, thread]));
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
    list.map((thread) => {
      const result = rootsById.get(thread.id);
      return result
        ? {
            ...thread,
            pinnedAt: result.pinnedAt,
            pinSortKey: result.pinSortKey,
          }
        : thread;
    }),
  );
}

export function settleThreadListMembershipMutation({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): void {
  invalidateThreadListMembershipQueries({ queryClient, threadId });
}

export async function beginUnarchiveThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<ThreadListMutationTransaction> {
  const transaction = await runOptimisticThreadFieldTransaction({
    applyToLists: (queryClient, threadId) => {
      const thread =
        getCachedThreadLists(queryClient, {
          queryKey: threadsQueryKey(),
        })
          .flatMap(({ data }) => [...iterateThreadListCacheEntries(data)])
          .find((candidate) => candidate.id === threadId) ??
        getCachedSidebarNavigationThreads(queryClient).find(
          (candidate) => candidate.id === threadId,
        );
      removeThreadFromLists(queryClient, threadId);
      if (!thread) return;
      applyToCachedSidebarNavigationThreads({
        queryClient,
        mapper: (list, projectId) =>
          projectId === thread.projectId
            ? [...list, { ...thread, archivedAt: null }]
            : list,
      });
    },
    patch: { archivedAt: null },
    queryClient,
    threadId,
  });
  return {
    ...transaction,
    rollbackFields: () => {
      transaction.rollbackFields();
      const wasInSidebar =
        transaction.previousSidebarNavigation &&
        listSidebarNavigationThreads(
          transaction.previousSidebarNavigation,
        ).some((thread) => thread.id === threadId);
      if (!wasInSidebar) {
        applyToCachedSidebarNavigationThreads({
          queryClient,
          mapper: (list) => list.filter((thread) => thread.id !== threadId),
        });
      }
      restoreThreadListMembership({
        queryClient,
        threadIds: new Set([threadId]),
        previousThreadLists: transaction.previousThreadLists,
        previousSidebarNavigation: transaction.previousSidebarNavigation,
      });
    },
  };
}

async function beginArchiveMatchingThreadsTransaction({
  matchesThread,
  queryClient,
}: ArchiveMatchingThreadsTransactionArgs): Promise<ArchiveThreadsTransaction> {
  const archivedThreadIds = getCachedLiveThreadIdsMatching({
    matchesThread,
    queryClient,
  });
  await Promise.all(
    archivedThreadIds.map((threadId) =>
      cancelOptimisticQueries(queryClient, {
        queryKey: threadQueryKey(threadId),
      }),
    ),
  );

  const previousThreadLists = getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const previousSidebarNavigation =
    snapshotCachedSidebarNavigation(queryClient);
  const previousThreads = getCachedThreadSnapshots({
    queryClient,
    threadIds: archivedThreadIds,
  });

  optimisticallyArchiveThreads({
    queryClient,
    threadIds: archivedThreadIds,
  });
  removeLiveThreadsFromCachedLists({
    matchesThread,
    queryClient,
  });

  return {
    archivedThreadIds,
    previousSidebarNavigation,
    previousThreadLists,
    previousThreads,
  };
}

function getCachedThreadTreeIds({
  queryClient,
  matchesRoot,
}: {
  queryClient: QueryClient;
  matchesRoot: (thread: ThreadListEntry) => boolean;
}): Set<string> {
  const threads = [
    ...getCachedSidebarNavigationThreads(queryClient),
    ...getCachedThreadLists(queryClient, {
      queryKey: threadsQueryKey(),
    }).flatMap(({ data }) => [...iterateThreadListCacheEntries(data)]),
  ];
  const childrenByParent = new Map<string, string[]>();
  const threadIds = new Set<string>();
  for (const thread of threads) {
    if (matchesRoot(thread)) threadIds.add(thread.id);
    if (thread.parentThreadId !== null) {
      const children = childrenByParent.get(thread.parentThreadId) ?? [];
      children.push(thread.id);
      childrenByParent.set(thread.parentThreadId, children);
    }
  }
  for (const threadId of threadIds) {
    for (const childId of childrenByParent.get(threadId) ?? [])
      threadIds.add(childId);
  }
  return threadIds;
}

export async function beginArchiveThreadAndChildrenTransaction({
  queryClient,
  threadId,
}: ArchiveThreadAndChildrenTransactionArgs): Promise<ArchiveThreadsTransaction> {
  await Promise.all([
    cancelOptimisticQueries(queryClient, { queryKey: threadsQueryKey() }),
    cancelOptimisticQueries(queryClient, {
      queryKey: sidebarNavigationQueryKey(),
    }),
  ]);
  const threadIds = getCachedThreadTreeIds({
    queryClient,
    matchesRoot: (thread) => thread.id === threadId,
  });
  return beginArchiveMatchingThreadsTransaction({
    queryClient,
    matchesThread: (thread) => threadIds.has(thread.id),
  });
}

export async function beginArchiveEnvironmentThreadsTransaction({
  queryClient,
  environmentId,
}: {
  queryClient: QueryClient;
  environmentId: string;
}): Promise<ArchiveThreadsTransaction> {
  await Promise.all([
    cancelOptimisticQueries(queryClient, { queryKey: threadsQueryKey() }),
    cancelOptimisticQueries(queryClient, {
      queryKey: sidebarNavigationQueryKey(),
    }),
  ]);
  const threadIds = getCachedThreadTreeIds({
    queryClient,
    matchesRoot: (thread) =>
      thread.environmentId === environmentId && thread.archivedAt === null,
  });
  return beginArchiveMatchingThreadsTransaction({
    queryClient,
    matchesThread: (thread) => threadIds.has(thread.id),
  });
}

function restoreThreadListMembership({
  queryClient,
  threadIds,
  previousThreadLists,
  previousSidebarNavigation,
}: {
  queryClient: QueryClient;
  threadIds: ReadonlySet<string>;
  previousThreadLists: CachedThreadListSnapshot;
  previousSidebarNavigation: CachedSidebarNavigationSnapshot;
}): void {
  restoreCachedThreadLists(queryClient, previousThreadLists, threadIds);
  if (!previousSidebarNavigation) return;
  const previousProjects = [
    previousSidebarNavigation.personalProject,
    ...previousSidebarNavigation.projects,
  ];
  applyToCachedSidebarNavigationThreads({
    queryClient,
    mapper: (list, projectId) =>
      restoreRemovedThreadEntries(
        list,
        previousProjects.find((project) => project.id === projectId)?.threads ??
          [],
        threadIds,
      ),
  });
}

export function rollbackArchiveThreadsTransaction({
  queryClient,
  transaction,
}: RollbackArchiveThreadsTransactionArgs): void {
  if (!transaction) {
    return;
  }

  restoreThreadListMembership({
    queryClient,
    threadIds: new Set(transaction.archivedThreadIds),
    previousThreadLists: transaction.previousThreadLists,
    previousSidebarNavigation: transaction.previousSidebarNavigation,
  });
  for (const snapshot of transaction.previousThreads) {
    queryClient.setQueryData(threadQueryKey(snapshot.id), snapshot.thread);
  }
}

export function settleArchiveThreadsTransaction({
  queryClient,
  response,
  transaction,
}: SettleArchiveThreadsTransactionArgs): void {
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  queryClient.invalidateQueries({ queryKey: threadSearchQueryKeyPrefix() });
  for (const threadId of response?.archivedThreadIds ??
    transaction?.archivedThreadIds ??
    []) {
    queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  }
}

export async function beginDeleteThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<DeleteThreadTransaction> {
  await cancelOptimisticQueries(queryClient, {
    queryKey: threadQueryKey(threadId),
  });
  await cancelOptimisticQueries(queryClient, { queryKey: threadsQueryKey() });
  await cancelOptimisticQueries(queryClient, {
    queryKey: sidebarNavigationQueryKey(),
  });

  const previousThread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  });
  const previousSidebarNavigation =
    snapshotCachedSidebarNavigation(queryClient);
  const threadIds = [
    ...getCachedThreadTreeIds({
      queryClient,
      matchesRoot: (thread) => thread.id === threadId,
    }),
  ];
  if (!threadIds.includes(threadId)) threadIds.push(threadId);
  await Promise.all(
    threadIds.map((id) =>
      cancelOptimisticQueries(queryClient, { queryKey: threadQueryKey(id) }),
    ),
  );
  const previousThreads = getCachedThreadSnapshots({ queryClient, threadIds });
  const environmentId = previousThread?.environmentId;

  for (const id of threadIds)
    removeThreadScopedQueries({ queryClient, threadId: id });
  removeEnvironmentScopedQueries({ environmentId, queryClient });
  const removedIds = new Set(threadIds);
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
    list.filter((thread) => !removedIds.has(thread.id)),
  );
  return {
    environmentId,
    threadIds,
    previousSidebarNavigation,
    previousThreads,
    previousThreadLists,
  };
}

export function rollbackDeleteThreadTransaction({
  queryClient,
  transaction,
}: RollbackDeleteThreadTransactionArgs): void {
  if (!transaction) return;
  for (const snapshot of transaction.previousThreads)
    queryClient.setQueryData(threadQueryKey(snapshot.id), snapshot.thread);
  restoreThreadListMembership({
    queryClient,
    threadIds: new Set(transaction.threadIds),
    previousThreadLists: transaction.previousThreadLists,
    previousSidebarNavigation: transaction.previousSidebarNavigation,
  });
}

export function settleDeleteThreadTransaction({
  queryClient,
  threadId,
  transaction,
}: SettleDeleteThreadTransactionArgs): void {
  for (const id of transaction?.threadIds ?? [threadId])
    removeThreadScopedQueries({ queryClient, threadId: id });
  removeEnvironmentScopedQueries({
    environmentId: transaction?.environmentId,
    queryClient,
  });
  invalidateThreadDeleteQueries({ queryClient });
}

export function applyThreadReadStateResult({
  queryClient,
  thread,
}: ThreadRuntimeCacheArgs): void {
  queryClient.setQueryData<ThreadWithRuntime>(
    threadQueryKey(thread.id),
    (current) =>
      current ? { ...current, lastReadAt: thread.lastReadAt } : current,
  );
  applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
    list.map((current) =>
      current.id === thread.id
        ? { ...current, lastReadAt: thread.lastReadAt }
        : current,
    ),
  );
}
