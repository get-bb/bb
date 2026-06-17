import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import type {
  PromptHistoryEntry,
  ThreadQueuedMessage,
  ThreadWithRuntime,
} from "@bb/domain";
import type {
  PromptHistoryResponse,
  ThreadQueuedMessageListResponse,
  ThreadResponse,
  TimelineConversationAttachments,
  TimelineRow,
} from "@bb/server-contract";
import type { AppCreateThreadRequest } from "@/lib/api";
import { collectPromptAttachments } from "@/lib/prompt-attachments";
import { prependPromptHistoryEntry } from "@/lib/prompt-history";
import {
  applyQueuedMessageReorder,
  type QueuedMessageReorderRequest,
} from "@/lib/queued-message-reorder";
import type { SendThreadMessageMutationRequest } from "../mutations/mutation-request-types";
import {
  insertOptimisticTimelineRow,
  optimisticallyInsertThread,
  removeOptimisticTimelineRow,
  updateCachedThread,
} from "./query-cache";
import {
  applyToCachedThreadLists,
  getCachedThreadLists,
  type ThreadListCacheData,
} from "./thread-list-cache-data";
import {
  projectPromptHistoryQueryKey,
  projectSourceBranchesQueryKeyPrefix,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadsQueryKey,
  threadTimelineQueryKeyPrefix,
  threadTimelineTurnSummaryDetailsQueryKeyPrefix,
} from "../queries/query-keys";
import {
  invalidateProjectPromptHistoryQueries,
  invalidateThreadAcceptedMessageQueries,
  invalidateThreadAcceptedMessageQueriesWithoutRealtime,
  invalidateThreadQueueQueries,
  invalidateThreadQueuedMessageSendQueries,
  invalidateThreadStopQueries,
  refetchThreadListsAfterComposerThreadCreate,
} from "./mutation-cache-effects";

interface ThreadIdCacheArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface BeginCreateThreadTransactionArgs {
  queryClient: QueryClient;
}

interface CreateThreadSuccessArgs {
  queryClient: QueryClient;
  request: AppCreateThreadRequest;
  thread: ThreadResponse;
}

interface SendThreadMessageTransactionArgs {
  queryClient: QueryClient;
  request: SendThreadMessageMutationRequest;
}

interface RollbackSendThreadMessageTransactionArgs {
  queryClient: QueryClient;
  request: SendThreadMessageMutationRequest;
  transaction: SendThreadMessageTransaction | undefined;
}

interface ApplySendThreadMessageSuccessArgs {
  queryClient: QueryClient;
  realtimeConnected: boolean;
  request: SendThreadMessageMutationRequest;
  transaction: SendThreadMessageTransaction | undefined;
}

interface QueuedMessageSuccessArgs {
  queryClient: QueryClient;
  queuedMessage: ThreadQueuedMessage;
  threadId: string;
}

interface ReorderQueuedMessageRequest extends QueuedMessageReorderRequest {
  id: string;
}

interface ReorderQueuedMessageTransactionArgs {
  queryClient: QueryClient;
  request: ReorderQueuedMessageRequest;
}

interface RollbackQueuedMessageTransactionArgs {
  queryClient: QueryClient;
  request: ReorderQueuedMessageRequest;
  transaction: ReorderQueuedMessageTransaction | undefined;
}

interface ApplyQueuedMessageReorderResultArgs {
  queryClient: QueryClient;
  queuedMessages: ThreadQueuedMessageListResponse;
  request: ReorderQueuedMessageRequest;
}

interface StopThreadTransactionArgs extends ThreadIdCacheArgs {
  requestedAt: number;
}

interface RollbackStopThreadTransactionArgs extends ThreadIdCacheArgs {
  transaction: StopThreadTransaction | undefined;
}

interface ThreadListSnapshotEntry {
  data: ThreadListCacheData;
  queryKey: QueryKey;
}

type ThreadListSnapshot = ThreadListSnapshotEntry[];

interface BuildAcceptedPromptHistoryEntryArgs {
  createdAt: number;
  input: PromptHistoryEntry["input"];
}

interface ApplyOptimisticStopRequestArgs extends StopThreadTransactionArgs {}

interface BuildOptimisticUserMessageRowParams {
  createdAt: number;
  input: SendThreadMessageMutationRequest["input"];
  mode: SendThreadMessageMutationRequest["mode"];
  threadId: string;
  threadStatus: ThreadWithRuntime["status"] | null;
}

type OptimisticTurnRequestKind = "message" | "steer";

interface OptimisticTurnRequestKindArgs {
  mode: SendThreadMessageMutationRequest["mode"];
  threadStatus: ThreadWithRuntime["status"] | null;
}

export interface SendThreadMessageAcceptedTurnTransaction {
  kind: "accepted-turn";
  optimisticCreatedAt: number;
  optimisticRowId: string;
  previousThread: ThreadResponse | undefined;
}

export interface SendThreadMessageQueuedTransaction {
  kind: "queued-message";
}

export type SendThreadMessageTransaction =
  | SendThreadMessageAcceptedTurnTransaction
  | SendThreadMessageQueuedTransaction;

export interface ReorderQueuedMessageTransaction {
  previousQueuedMessages: ThreadQueuedMessageListResponse | undefined;
}

export interface StopThreadTransaction {
  previousThread: ThreadResponse | undefined;
  previousThreadLists: ThreadListSnapshot;
}

function buildAcceptedPromptHistoryEntry({
  createdAt,
  input,
}: BuildAcceptedPromptHistoryEntryArgs): PromptHistoryEntry {
  return {
    id: `optimistic-prompt-history:${nanoid()}`,
    createdAt,
    input,
  };
}

function buildQueuedPromptHistoryEntry(
  queuedMessage: ThreadQueuedMessage,
): PromptHistoryEntry {
  return {
    id: `queued-message:${queuedMessage.id}`,
    createdAt: queuedMessage.createdAt,
    input: queuedMessage.content,
  };
}

function prependProjectPromptHistory(
  queryClient: QueryClient,
  projectId: string,
  entry: PromptHistoryEntry,
): void {
  queryClient.setQueryData<PromptHistoryResponse>(
    projectPromptHistoryQueryKey(projectId),
    (currentEntries) => prependPromptHistoryEntry(currentEntries, entry),
  );
}

function prependThreadPromptHistory(
  queryClient: QueryClient,
  threadId: string,
  entry: PromptHistoryEntry,
): void {
  queryClient.setQueryData<PromptHistoryResponse>(
    threadPromptHistoryQueryKey(threadId),
    (currentEntries) => prependPromptHistoryEntry(currentEntries, entry),
  );
}

function hasUnmanagedCheckoutIntent(request: AppCreateThreadRequest): boolean {
  return (
    request.environment.type === "host" &&
    request.environment.workspace.type === "unmanaged" &&
    request.environment.workspace.branch !== undefined
  );
}

function snapshotThreadLists(queryClient: QueryClient): ThreadListSnapshot {
  return getCachedThreadLists(queryClient, { queryKey: threadsQueryKey() });
}

function restoreThreadLists(
  queryClient: QueryClient,
  threadLists: ThreadListSnapshot,
): void {
  for (const { queryKey, data } of threadLists) {
    queryClient.setQueryData(queryKey, data);
  }
}

function optimisticTurnRequestKind({
  mode,
  threadStatus,
}: OptimisticTurnRequestKindArgs): OptimisticTurnRequestKind {
  if (mode === "steer" || mode === "steer-if-active") {
    return "steer";
  }
  if (mode === "auto" && threadStatus === "active") {
    return "steer";
  }
  return "message";
}

function requestWillQueueForActiveThread(
  request: SendThreadMessageMutationRequest,
  thread: ThreadWithRuntime | undefined,
): boolean {
  return request.mode === "queue-if-active" && thread?.status === "active";
}

function buildOptimisticUserMessageRow({
  createdAt,
  input,
  mode,
  threadId,
  threadStatus,
}: BuildOptimisticUserMessageRowParams): TimelineRow {
  const id = `optimistic-user-${nanoid()}`;
  const text = input
    .filter(
      (entry): entry is Extract<typeof entry, { type: "text" }> =>
        entry.type === "text" && entry.visibility !== "agent-only",
    )
    .map((entry) => entry.text)
    .join("\n\n");
  const attachments = collectPromptAttachments(input);
  const timelineAttachments: TimelineConversationAttachments | null =
    attachments
      ? {
          webImages: attachments.webImages,
          localImages: attachments.localImages,
          localFiles: attachments.localFiles,
          imageUrls: attachments.imageUrls ?? [],
          localImagePaths: attachments.localImagePaths ?? [],
          localFilePaths: attachments.localFilePaths ?? [],
        }
      : null;
  return {
    id,
    kind: "conversation",
    role: "user",
    threadId,
    turnId: null,
    sourceSeqStart: 0,
    sourceSeqEnd: 0,
    startedAt: createdAt,
    createdAt,
    text,
    mentions: [],
    attachments: timelineAttachments,
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: {
      kind: optimisticTurnRequestKind({ mode, threadStatus }),
      status: "pending",
    },
  };
}

function applyOptimisticStopRequest({
  queryClient,
  requestedAt,
  threadId,
}: ApplyOptimisticStopRequestArgs): void {
  updateCachedThread(queryClient, threadId, (thread) => ({
    ...thread,
    status: "stopping",
    runtime: { ...thread.runtime, displayStatus: "stopping" },
    updatedAt: Math.max(thread.updatedAt, requestedAt),
  }));

  applyToCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
    mapper: (list) =>
      list.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              status: "stopping",
              runtime: { ...thread.runtime, displayStatus: "stopping" },
              updatedAt: Math.max(thread.updatedAt, requestedAt),
            }
          : thread,
      ),
  });
}

export async function beginCreateThreadTransaction({
  queryClient,
}: BeginCreateThreadTransactionArgs): Promise<void> {
  await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
}

export function applyCreateThreadResult({
  queryClient,
  request,
  thread,
}: CreateThreadSuccessArgs): void {
  queryClient.setQueryData<ThreadResponse>(
    threadQueryKey(thread.id),
    thread,
  );
  optimisticallyInsertThread(queryClient, thread);
  prependProjectPromptHistory(
    queryClient,
    request.projectId,
    buildAcceptedPromptHistoryEntry({
      createdAt: thread.createdAt,
      input: request.input,
    }),
  );
  invalidateProjectPromptHistoryQueries({
    queryClient,
    projectId: request.projectId,
  });
  if (hasUnmanagedCheckoutIntent(request)) {
    queryClient.invalidateQueries({
      queryKey: projectSourceBranchesQueryKeyPrefix(request.projectId),
    });
  }
  refetchThreadListsAfterComposerThreadCreate({ queryClient });
}

export async function beginSendThreadMessageTransaction({
  queryClient,
  request,
}: SendThreadMessageTransactionArgs): Promise<SendThreadMessageTransaction> {
  await queryClient.cancelQueries({ queryKey: threadQueryKey(request.id) });

  const previousThread = queryClient.getQueryData<ThreadResponse>(
    threadQueryKey(request.id),
  );
  if (requestWillQueueForActiveThread(request, previousThread)) {
    await queryClient.cancelQueries({
      queryKey: threadQueuedMessagesQueryKey(request.id),
    });
    return { kind: "queued-message" };
  }

  await Promise.all([
    queryClient.cancelQueries({
      queryKey: threadTimelineQueryKeyPrefix(request.id),
    }),
    queryClient.cancelQueries({
      queryKey: threadTimelineTurnSummaryDetailsQueryKeyPrefix(request.id),
    }),
  ]);
  const optimisticCreatedAt = Date.now();

  updateCachedThread(queryClient, request.id, (thread) => ({
    ...thread,
    status: "active",
    updatedAt: Math.max(thread.updatedAt, optimisticCreatedAt),
    runtime: {
      ...thread.runtime,
      // Flip displayStatus so the working indicator mounts with the optimistic
      // user-message row. Preserve host blockers because promoting them to
      // "active" would misrepresent host readiness.
      displayStatus:
        thread.runtime.displayStatus === "host-reconnecting" ||
        thread.runtime.displayStatus === "waiting-for-host"
          ? thread.runtime.displayStatus
          : "active",
    },
  }));

  const optimisticRow = buildOptimisticUserMessageRow({
    createdAt: optimisticCreatedAt,
    input: request.input,
    mode: request.mode,
    threadId: request.id,
    threadStatus: previousThread?.status ?? null,
  });
  insertOptimisticTimelineRow(queryClient, request.id, optimisticRow);

  return {
    kind: "accepted-turn",
    previousThread,
    optimisticCreatedAt,
    optimisticRowId: optimisticRow.id,
  };
}

export function rollbackSendThreadMessageTransaction({
  queryClient,
  request,
  transaction,
}: RollbackSendThreadMessageTransactionArgs): void {
  if (transaction?.kind !== "accepted-turn") {
    return;
  }
  if (transaction.optimisticRowId) {
    removeOptimisticTimelineRow(
      queryClient,
      request.id,
      transaction.optimisticRowId,
    );
  }
  if (!transaction?.previousThread) {
    return;
  }

  queryClient.setQueryData<ThreadResponse>(
    threadQueryKey(request.id),
    transaction.previousThread,
  );
}

export function applySendThreadMessageSuccess({
  queryClient,
  realtimeConnected,
  request,
  transaction,
}: ApplySendThreadMessageSuccessArgs): void {
  if (transaction?.kind === "queued-message") {
    invalidateThreadQueueQueries({ queryClient, threadId: request.id });
    return;
  }
  prependThreadPromptHistory(
    queryClient,
    request.id,
    buildAcceptedPromptHistoryEntry({
      createdAt: transaction?.optimisticCreatedAt ?? Date.now(),
      input: request.input,
    }),
  );
  const invalidateAcceptedMessageQueries = realtimeConnected
    ? invalidateThreadAcceptedMessageQueries
    : invalidateThreadAcceptedMessageQueriesWithoutRealtime;

  invalidateAcceptedMessageQueries({
    queryClient,
    threadId: request.id,
  });
}

export function applyQueuedMessageCreateResult({
  queryClient,
  queuedMessage,
  threadId,
}: QueuedMessageSuccessArgs): void {
  prependThreadPromptHistory(
    queryClient,
    threadId,
    buildQueuedPromptHistoryEntry(queuedMessage),
  );
  invalidateThreadQueueQueries({ queryClient, threadId });
}

export function applyQueuedMessageSendResult({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): void {
  invalidateThreadQueuedMessageSendQueries({ queryClient, threadId });
}

export async function beginReorderQueuedMessageTransaction({
  queryClient,
  request,
}: ReorderQueuedMessageTransactionArgs): Promise<ReorderQueuedMessageTransaction> {
  const queryKey = threadQueuedMessagesQueryKey(request.id);
  const previousQueuedMessages =
    queryClient.getQueryData<ThreadQueuedMessageListResponse>(queryKey);

  // Apply the optimistic reorder synchronously — before awaiting cancelQueries
  // — so the list re-renders in its new order within the same tick as the drop.
  // If this write lands a microtask late (after the await), dnd-kit has already
  // animated the dragged row back to its original slot, producing a visible
  // snap-back before it settles into place.
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    queryKey,
    (currentQueuedMessages) =>
      currentQueuedMessages
        ? applyQueuedMessageReorder({
            queuedMessages: currentQueuedMessages,
            request,
          })
        : currentQueuedMessages,
  );

  await queryClient.cancelQueries({ queryKey });

  return { previousQueuedMessages };
}

export function rollbackReorderQueuedMessageTransaction({
  queryClient,
  request,
  transaction,
}: RollbackQueuedMessageTransactionArgs): void {
  if (transaction?.previousQueuedMessages !== undefined) {
    queryClient.setQueryData<ThreadQueuedMessageListResponse>(
      threadQueuedMessagesQueryKey(request.id),
      transaction.previousQueuedMessages,
    );
  }
  invalidateThreadQueueQueries({
    queryClient,
    threadId: request.id,
  });
}

export function applyQueuedMessageReorderResult({
  queryClient,
  queuedMessages,
  request,
}: ApplyQueuedMessageReorderResultArgs): void {
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    threadQueuedMessagesQueryKey(request.id),
    queuedMessages,
  );
  invalidateThreadQueueQueries({
    queryClient,
    threadId: request.id,
  });
}

export function applyQueuedMessageDeleteResult({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): void {
  invalidateThreadQueueQueries({ queryClient, threadId });
}

export async function beginStopThreadTransaction({
  queryClient,
  requestedAt,
  threadId,
}: StopThreadTransactionArgs): Promise<StopThreadTransaction> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) }),
    queryClient.cancelQueries({ queryKey: threadsQueryKey() }),
  ]);

  const previousThread = queryClient.getQueryData<ThreadResponse>(
    threadQueryKey(threadId),
  );
  const previousThreadLists = snapshotThreadLists(queryClient);

  applyOptimisticStopRequest({
    queryClient,
    requestedAt,
    threadId,
  });

  return {
    previousThread,
    previousThreadLists,
  };
}

export function rollbackStopThreadTransaction({
  queryClient,
  threadId,
  transaction,
}: RollbackStopThreadTransactionArgs): void {
  if (!transaction) {
    return;
  }

  queryClient.setQueryData(
    threadQueryKey(threadId),
    transaction.previousThread,
  );
  restoreThreadLists(queryClient, transaction.previousThreadLists);
}

export function settleStopThreadTransaction({
  queryClient,
  threadId,
}: ThreadIdCacheArgs): void {
  invalidateThreadStopQueries({ queryClient, threadId });
}
