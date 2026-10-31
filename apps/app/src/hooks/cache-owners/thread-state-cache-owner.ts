import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  UpdateThreadRequest,
  ThreadArchiveAllResponse,
} from "@bb/server-contract";
import {
  sidebarNavigationQueryKey,
  threadDetailBootstrapQueryKey,
  threadQueryKey,
  threadReadStateMutationKey,
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
import { isArchivedThreadListQueryKey } from "./query-cache";
import {
  beginThreadEntityPrediction,
  findThreadTreeIds,
  getThreadEntity,
  insertThreadIntoSidebar,
  patchThreadEntity,
  queryMayShowThread,
  writeThreadEntity,
  type ThreadEntity,
  type ThreadEntityPrediction,
} from "./thread-entity-store";
import {
  fenceThreadReadState,
  hasThreadReadStateFence,
  releaseThreadReadStateFences,
  withThreadReadStateIntent,
  type ThreadReadStateIntent,
} from "./thread-read-state-fences";
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

type ThreadReadStateResult = Pick<
  ThreadWithRuntime,
  "lastReadAt" | "latestAttentionAt"
>;

type ThreadReadStateRequest =
  | { kind: "read"; throughAttentionAt: number | undefined }
  | { kind: "unread" };

export interface ThreadReadStateTransaction {
  readonly threadId: string;
  readonly intent: ThreadReadStateIntent;
  readonly prediction: ThreadEntityPrediction;
  readonly supersededListeners: Set<() => void>;
}

const pendingReadStateTransactions = new WeakMap<
  QueryClient,
  Map<string, ThreadReadStateTransaction[]>
>();

const failedThreadReads = new WeakMap<
  QueryClient,
  Map<string, number | null>
>();

function resolveThreadReadStateIntent(
  queryClient: QueryClient,
  threadId: string,
  intent: ThreadReadStateRequest,
): ThreadReadStateIntent {
  if (intent.kind === "unread") {
    return { kind: "unread", latestAttentionAt: null };
  }
  return {
    kind: "read",
    lastReadAt:
      intent.throughAttentionAt ??
      getThreadEntity(queryClient, threadId)?.thread.latestAttentionAt ??
      null,
    latestAttentionAt: null,
  };
}

function withThreadReadStateResult(
  entity: ThreadEntity,
  result: ThreadReadStateResult,
): ThreadEntity {
  const latestAttentionAt = Math.max(
    entity.thread.latestAttentionAt ?? result.latestAttentionAt,
    result.latestAttentionAt,
  );
  return entity.thread.lastReadAt === result.lastReadAt &&
    entity.thread.latestAttentionAt === latestAttentionAt
    ? entity
    : withThread(entity, { lastReadAt: result.lastReadAt, latestAttentionAt });
}

function settledThreadReadStateIntent(
  intent: ThreadReadStateIntent,
  thread: ThreadWithRuntime,
): ThreadReadStateIntent {
  return intent.kind === "unread"
    ? { kind: "unread", latestAttentionAt: thread.latestAttentionAt }
    : {
        kind: "read",
        lastReadAt: thread.lastReadAt,
        latestAttentionAt: thread.latestAttentionAt,
      };
}

function pendingThreadReadStates(
  queryClient: QueryClient,
  threadId: string,
): ThreadReadStateTransaction[] {
  return pendingReadStateTransactions.get(queryClient)?.get(threadId) ?? [];
}

function removePendingThreadReadState(
  queryClient: QueryClient,
  transaction: ThreadReadStateTransaction,
): { found: boolean; wasLatest: boolean } {
  const byThread = pendingReadStateTransactions.get(queryClient);
  const pending = byThread?.get(transaction.threadId);
  const index = pending?.indexOf(transaction) ?? -1;
  if (!byThread || !pending || index === -1) {
    return { found: false, wasLatest: false };
  }
  const wasLatest = index === pending.length - 1;
  pending.splice(index, 1);
  if (pending.length === 0) byThread.delete(transaction.threadId);
  return { found: true, wasLatest };
}

function holdsThreadReadState(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  return (
    pendingThreadReadStates(queryClient, threadId).length > 0 ||
    hasThreadReadStateFence(queryClient, threadId)
  );
}

function forgetFailedThreadRead(
  queryClient: QueryClient,
  threadId: string,
): void {
  failedThreadReads.get(queryClient)?.delete(threadId);
}

function rememberFailedThreadRead(
  queryClient: QueryClient,
  transaction: ThreadReadStateTransaction,
): void {
  if (transaction.intent.kind !== "read") return;
  let byThread = failedThreadReads.get(queryClient);
  if (!byThread) {
    byThread = new Map();
    failedThreadReads.set(queryClient, byThread);
  }
  byThread.set(transaction.threadId, transaction.intent.lastReadAt);
}

function dropUnshownThreadCopies(
  queryClient: QueryClient,
  threadId: string,
): void {
  for (const queryKey of [
    threadQueryKey(threadId),
    threadDetailBootstrapQueryKey(threadId),
  ]) {
    queryClient.removeQueries({
      queryKey,
      exact: true,
      predicate: (query) => query.getObserversCount() === 0,
    });
  }
}

function refetchThreadReadState(
  queryClient: QueryClient,
  threadId: string,
): void {
  void queryClient.invalidateQueries(
    {
      predicate: (query) =>
        queryMayShowThread(query.queryKey, threadId) &&
        !isArchivedThreadListQueryKey(query.queryKey),
    },
    { cancelRefetch: false },
  );
  void queryClient.invalidateQueries({
    predicate: (query) =>
      queryMayShowThread(query.queryKey, threadId) &&
      isArchivedThreadListQueryKey(query.queryKey),
    refetchType: "none",
  });
}

export function threadReadStateMutationIdentity() {
  return { mutationKey: threadReadStateMutationKey() };
}

export function noteThreadSeenRead(
  queryClient: QueryClient,
  threadId: string,
): void {
  if (!holdsThreadReadState(queryClient, threadId)) {
    forgetFailedThreadRead(queryClient, threadId);
  }
}

export function hasFailedThreadRead(
  queryClient: QueryClient,
  threadId: string,
  latestAttentionAt: number,
): boolean {
  const byThread = failedThreadReads.get(queryClient);
  return (
    byThread?.has(threadId) === true &&
    byThread.get(threadId) === latestAttentionAt
  );
}

export function isLatestThreadReadStateTransaction(
  queryClient: QueryClient,
  transaction: ThreadReadStateTransaction,
): boolean {
  return (
    pendingThreadReadStates(queryClient, transaction.threadId).at(-1) ===
    transaction
  );
}

export function whenThreadReadStateSuperseded(
  transaction: ThreadReadStateTransaction,
  listener: () => void,
): () => void {
  transaction.supersededListeners.add(listener);
  return () => {
    transaction.supersededListeners.delete(listener);
  };
}

export function beginThreadReadStateTransaction({
  intent,
  queryClient,
  threadId,
}: ThreadIdCacheArgs & {
  intent: ThreadReadStateRequest;
}): ThreadReadStateTransaction {
  const resolvedIntent = resolveThreadReadStateIntent(
    queryClient,
    threadId,
    intent,
  );
  forgetFailedThreadRead(queryClient, threadId);
  const transaction: ThreadReadStateTransaction = {
    threadId,
    intent: resolvedIntent,
    prediction: beginThreadEntityPrediction(queryClient, {
      threadIds: [threadId],
      update: (entity) => withThreadReadStateIntent(entity, resolvedIntent),
    }),
    supersededListeners: new Set(),
  };
  let byThread = pendingReadStateTransactions.get(queryClient);
  if (!byThread) {
    byThread = new Map();
    pendingReadStateTransactions.set(queryClient, byThread);
  }
  const pending = byThread.get(threadId) ?? [];
  byThread.set(threadId, [...pending, transaction]);
  for (const earlier of pending) {
    for (const listener of [...earlier.supersededListeners]) listener();
  }
  return transaction;
}

export function settleThreadReadStateSuccess({
  queryClient,
  thread,
  transaction,
}: {
  queryClient: QueryClient;
  thread: ThreadWithRuntime;
  transaction: ThreadReadStateTransaction | undefined;
}): void {
  if (!transaction) return;
  const { found, wasLatest } = removePendingThreadReadState(
    queryClient,
    transaction,
  );
  if (!found) return;
  writeThreadEntity(queryClient, transaction.threadId, (entity) =>
    withThreadReadStateResult(entity, {
      lastReadAt: thread.lastReadAt,
      latestAttentionAt: thread.latestAttentionAt,
    }),
  );
  transaction.prediction.fail();
  if (!wasLatest) return;
  forgetFailedThreadRead(queryClient, transaction.threadId);
  releaseThreadReadStateFences(queryClient, transaction.threadId);
  fenceThreadReadState(queryClient, {
    asOf: thread.updatedAt,
    settled: settledThreadReadStateIntent(transaction.intent, thread),
    threadId: transaction.threadId,
  });
}

export function settleThreadReadStateFailure({
  queryClient,
  transaction,
}: {
  queryClient: QueryClient;
  transaction: ThreadReadStateTransaction | undefined;
}): void {
  if (!transaction) return;
  const { found, wasLatest } = removePendingThreadReadState(
    queryClient,
    transaction,
  );
  if (!found) return;
  if (!wasLatest) {
    transaction.prediction.fail();
    return;
  }
  rememberFailedThreadRead(queryClient, transaction);
  releaseThreadReadStateFences(queryClient, transaction.threadId);
  writeThreadEntity(queryClient, transaction.threadId, (entity) =>
    withThreadReadStateIntent(entity, transaction.intent),
  );
  transaction.prediction.fail();
  dropUnshownThreadCopies(queryClient, transaction.threadId);
  fenceThreadReadState(queryClient, {
    onDone: () => refetchThreadReadState(queryClient, transaction.threadId),
    settled: transaction.intent,
    threadId: transaction.threadId,
  });
}

export function abandonThreadReadStateTransaction({
  queryClient,
  transaction,
}: {
  queryClient: QueryClient;
  transaction: ThreadReadStateTransaction;
}): void {
  const { found, wasLatest } = removePendingThreadReadState(
    queryClient,
    transaction,
  );
  if (!found) return;
  transaction.prediction.fail();
  if (!wasLatest) return;
  rememberFailedThreadRead(queryClient, transaction);
  dropUnshownThreadCopies(queryClient, transaction.threadId);
  refetchThreadReadState(queryClient, transaction.threadId);
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
