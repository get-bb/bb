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
  beginThreadEntityPrediction,
  findThreadTreeIds,
  getThreadEntity,
  insertThreadIntoSidebar,
  patchThreadEntity,
  type ThreadEntity,
  type ThreadEntityPrediction,
} from "./thread-entity-store";
import { readThreadBack } from "./thread-read-back";

interface ThreadIdCacheArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface ThreadMetadataUpdate {
  threadId: string;
  parentThreadId?: string | null;
  sectionId?: string | null;
  title?: string | null;
}

type ThreadMetadataPatch = Partial<
  Pick<ThreadWithRuntime, "parentThreadId" | "sectionId" | "title">
>;

type ThreadFieldsResult = Partial<ThreadWithRuntime>;

export interface ThreadListMutationTransaction {
  prediction: ThreadEntityPrediction;
}

export interface ThreadReadStateTransaction extends ThreadListMutationTransaction {
  lastReadAt: number | null;
}

export interface ThreadMetadataBatchTransaction {
  prediction: ThreadEntityPrediction;
}

export interface ArchiveThreadsTransaction {
  archivedThreadIds: string[];
  prediction: ThreadEntityPrediction;
}

export interface DeleteThreadTransaction {
  environmentId: string | null | undefined;
  threadIds: string[];
  previousThreads: { id: string; thread: ThreadWithRuntime | undefined }[];
  prediction: ThreadEntityPrediction;
}

function withThread(
  entity: ThreadEntity,
  fields: Partial<ThreadWithRuntime>,
): ThreadEntity {
  return { ...entity, thread: { ...entity.thread, ...fields } };
}

function getOptimisticLastReadAt(
  thread: Partial<Pick<ThreadWithRuntime, "latestAttentionAt">>,
  lastReadAt: number | null,
): number | null {
  if (lastReadAt === null) {
    return null;
  }
  return Math.max(lastReadAt, thread.latestAttentionAt ?? lastReadAt);
}

function responseMetadataPatch(
  thread: ThreadWithRuntime,
  request: UpdateThreadRequest,
): Partial<ThreadWithRuntime> {
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
  };
}

export function applyThreadUpdateResult({
  queryClient,
  thread,
  request,
  transaction,
}: {
  queryClient: QueryClient;
  thread: ThreadWithRuntime;
  request: UpdateThreadRequest;
  transaction?: ThreadListMutationTransaction | undefined;
}): void {
  if (transaction === undefined)
    patchThreadEntity(
      queryClient,
      thread.id,
      responseMetadataPatch(thread, request),
    );
  else transaction.prediction.confirm([thread], readThreadBack(queryClient));
  invalidateThreadListQueries({ queryClient });
}

export function predictThreadPinState(
  queryClient: QueryClient,
  { pinnedAt, threadId }: { pinnedAt: number | null; threadId: string },
): ThreadEntityPrediction {
  return beginThreadEntityPrediction(queryClient, {
    threadIds: [threadId],
    update: (entity) => ({
      ...withThread(entity, { pinnedAt }),
      list: entity.list && { ...entity.list, pinSortKey: null },
    }),
  });
}

export async function beginThreadReadStateTransaction({
  lastReadAt,
  queryClient,
  threadId,
}: ThreadIdCacheArgs & {
  lastReadAt: number | null;
}): Promise<ThreadReadStateTransaction> {
  const optimistic = {
    lastReadAt: getOptimisticLastReadAt(
      getThreadEntity(queryClient, threadId)?.thread ?? {},
      lastReadAt,
    ),
  };
  const prediction = beginThreadEntityPrediction(queryClient, {
    threadIds: [threadId],
    update: (entity) => withThread(entity, optimistic),
  });
  return { prediction, lastReadAt };
}

export function rollbackThreadReadStateTransaction({
  transaction,
}: ThreadIdCacheArgs & {
  transaction: ThreadReadStateTransaction | undefined;
}): void {
  transaction?.prediction.fail();
}

function resolveThreadMetadataPatch({
  parentThreadId,
  sectionId,
  queryClient,
  threadId,
  title,
}: ThreadMetadataUpdate & {
  queryClient: QueryClient;
}): ThreadMetadataPatch {
  if (parentThreadId === null && sectionId === undefined) {
    const parentId = getThreadEntity(queryClient, threadId)?.thread
      .parentThreadId;
    if (parentId) {
      const parent = getThreadEntity(queryClient, parentId);
      if (parent) {
        sectionId = parent.thread.sectionId;
      } else {
        parentThreadId = undefined;
      }
    }
  }
  return {
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
}: ThreadMetadataUpdate & {
  queryClient: QueryClient;
}): Promise<ThreadListMutationTransaction> {
  const patch = resolveThreadMetadataPatch({
    parentThreadId,
    queryClient,
    sectionId,
    threadId,
    title,
  });
  const prediction = beginThreadEntityPrediction(queryClient, {
    threadIds: [threadId],
    update: (entity) => withThread(entity, patch),
  });
  return Promise.resolve({ prediction });
}

export async function beginThreadMetadataBatchTransaction({
  queryClient,
  updates,
}: {
  queryClient: QueryClient;
  updates: readonly ThreadMetadataUpdate[];
}): Promise<ThreadMetadataBatchTransaction> {
  const patches = new Map<string, ThreadMetadataPatch>();
  for (const update of updates) {
    patches.set(update.threadId, {
      ...patches.get(update.threadId),
      ...resolveThreadMetadataPatch({ ...update, queryClient }),
    });
  }
  const prediction = beginThreadEntityPrediction(queryClient, {
    threadIds: [...patches.keys()],
    update: (entity, threadId) => withThread(entity, patches.get(threadId)!),
  });
  return { prediction };
}

export function rollbackThreadMetadataBatchTransaction({
  transaction,
}: {
  queryClient: QueryClient;
  transaction: ThreadMetadataBatchTransaction | undefined;
}): void {
  transaction?.prediction.fail();
}

export function applyThreadMetadataBatchResult({
  queryClient,
  transaction,
  updates,
}: {
  queryClient: QueryClient;
  transaction?: ThreadMetadataBatchTransaction | undefined;
  updates: readonly {
    thread: ThreadWithRuntime;
    request: UpdateThreadRequest;
  }[];
}): void {
  if (transaction === undefined) {
    const results = new Map<string, ThreadFieldsResult>();
    for (const { thread, request } of updates) {
      results.set(thread.id, {
        ...results.get(thread.id),
        ...responseMetadataPatch(thread, request),
      });
    }
    for (const [threadId, patch] of results)
      patchThreadEntity(queryClient, threadId, patch);
  } else
    transaction.prediction.confirm(
      updates.map(({ thread }) => thread),
      readThreadBack(queryClient),
    );
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
}: ThreadIdCacheArgs & {
  transaction: ThreadListMutationTransaction | undefined;
}): void {
  transaction?.prediction.fail();
}

export function succeedThreadListMutationTransaction(
  transaction: ThreadListMutationTransaction | undefined,
): void {
  transaction?.prediction.succeed();
}

export function applyPinnedThreadOrderResult({
  queryClient,
  orderedRoots,
}: {
  queryClient: QueryClient;
  orderedRoots: readonly ThreadListEntry[];
}): void {
  for (const thread of orderedRoots)
    patchThreadEntity(queryClient, thread.id, {
      pinnedAt: thread.pinnedAt,
      pinSortKey: thread.pinSortKey,
    });
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
  insertThreadIntoSidebar(queryClient, threadId);
  const prediction = beginThreadEntityPrediction(queryClient, {
    threadIds: [threadId],
    update: (entity) => withThread(entity, { archivedAt: null }),
  });
  return { prediction };
}

function beginArchiveThreadsTransaction(
  queryClient: QueryClient,
  matchesRoot: (thread: Partial<ThreadWithRuntime>) => boolean,
): ArchiveThreadsTransaction {
  const archivedThreadIds = findThreadTreeIds(queryClient, matchesRoot).filter(
    (id) => getThreadEntity(queryClient, id)?.thread.archivedAt == null,
  );
  const archivedAt = Date.now();
  return {
    archivedThreadIds,
    prediction: beginThreadEntityPrediction(queryClient, {
      threadIds: archivedThreadIds,
      update: (entity) =>
        entity.thread.archivedAt == null
          ? withThread(entity, { archivedAt })
          : entity,
    }),
  };
}

export async function beginArchiveThreadAndChildrenTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): Promise<ArchiveThreadsTransaction> {
  return beginArchiveThreadsTransaction(
    queryClient,
    (thread) => thread.id === threadId && thread.archivedAt == null,
  );
}

export async function beginArchiveEnvironmentThreadsTransaction({
  queryClient,
  environmentId,
}: {
  queryClient: QueryClient;
  environmentId: string;
}): Promise<ArchiveThreadsTransaction> {
  return beginArchiveThreadsTransaction(
    queryClient,
    (thread) =>
      thread.environmentId === environmentId && thread.archivedAt == null,
  );
}

export function rollbackArchiveThreadsTransaction({
  transaction,
}: {
  queryClient: QueryClient;
  transaction: ArchiveThreadsTransaction | undefined;
}): void {
  transaction?.prediction.fail();
}

export function settleArchiveThreadsTransaction({
  queryClient,
  response,
  transaction,
}: {
  queryClient: QueryClient;
  response: ThreadArchiveAllResponse | undefined;
  transaction: ArchiveThreadsTransaction | undefined;
}): void {
  if (response !== undefined) transaction?.prediction.succeed();
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
  const threadIds = findThreadTreeIds(
    queryClient,
    (thread) => thread.id === threadId,
  );
  if (!threadIds.includes(threadId)) threadIds.push(threadId);
  const previousThreads = threadIds.map((id) => ({
    id,
    thread: queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(id)),
  }));
  const environmentId = getThreadEntity(queryClient, threadId)?.thread
    .environmentId;
  const deletedAt = Date.now();
  const prediction = beginThreadEntityPrediction(queryClient, {
    threadIds,
    update: (entity) => withThread(entity, { deletedAt }),
  });
  for (const id of threadIds)
    removeThreadScopedQueries({ queryClient, threadId: id });
  removeEnvironmentScopedQueries({ environmentId, queryClient });
  return { environmentId, threadIds, previousThreads, prediction };
}

export function rollbackDeleteThreadTransaction({
  queryClient,
  transaction,
}: {
  queryClient: QueryClient;
  transaction: DeleteThreadTransaction | undefined;
}): void {
  if (!transaction) return;
  transaction.prediction.fail();
  for (const snapshot of transaction.previousThreads)
    if (snapshot.thread !== undefined)
      queryClient.setQueryData(threadQueryKey(snapshot.id), snapshot.thread);
}

export function settleDeleteThreadTransaction({
  queryClient,
  threadId,
  transaction,
}: ThreadIdCacheArgs & {
  transaction: DeleteThreadTransaction | undefined;
}): void {
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
  transaction,
}: {
  queryClient: QueryClient;
  thread: ThreadWithRuntime;
  transaction?: ThreadReadStateTransaction | undefined;
}): void {
  if (transaction === undefined)
    patchThreadEntity(queryClient, thread.id, {
      lastReadAt: thread.lastReadAt,
    });
  else transaction.prediction.confirm([thread], readThreadBack(queryClient));
}
