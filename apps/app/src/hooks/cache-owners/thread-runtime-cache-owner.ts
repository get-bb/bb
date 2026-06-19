import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import type {
  PromptHistoryEntry,
  ResolvedThreadExecutionOptions,
  ThreadQueuedMessage,
  ThreadWithRuntime,
} from "@bb/domain";
import type {
  CreateQueuedMessageRequest,
  PromptHistoryResponse,
  SendQueuedMessageMode,
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
import { threadDefaultExecutionOptionsQueryKey } from "../queries/thread-default-execution-options-query";
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

interface CreateQueuedMessageRequestWithThreadId extends CreateQueuedMessageRequest {
  id: string;
}

interface CreateQueuedMessageTransactionArgs {
  queryClient: QueryClient;
  request: CreateQueuedMessageRequestWithThreadId;
}

interface RemoveQueuedMessageRequest {
  id: string;
  queuedMessageId: string;
}

interface SendQueuedMessageRequest extends RemoveQueuedMessageRequest {
  mode: SendQueuedMessageMode;
}

interface RemoveQueuedMessageTransactionArgs {
  queryClient: QueryClient;
  request: RemoveQueuedMessageRequest;
}

interface SendQueuedMessageTransactionArgs {
  queryClient: QueryClient;
  request: SendQueuedMessageRequest;
}

interface RollbackSendThreadMessageTransactionArgs {
  queryClient: QueryClient;
  request: SendThreadMessageMutationRequest;
  transaction: SendThreadMessageTransaction | undefined;
}

interface RollbackCreateQueuedMessageTransactionArgs {
  queryClient: QueryClient;
  request: CreateQueuedMessageRequestWithThreadId;
  transaction: CreateQueuedMessageTransaction | undefined;
}

interface RollbackRemoveQueuedMessageTransactionArgs {
  queryClient: QueryClient;
  request: RemoveQueuedMessageRequest;
  transaction: RemoveQueuedMessageTransaction | undefined;
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
  transaction: CreateQueuedMessageTransaction | undefined;
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

interface BuildOptimisticQueuedMessageParams {
  createdAt: number;
  queryClient: QueryClient;
  request: CreateQueuedMessageRequestWithThreadId;
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
  optimisticQueuedMessageId: string;
  previousQueuedMessages: ThreadQueuedMessageListResponse | undefined;
}

export type SendThreadMessageTransaction =
  | SendThreadMessageAcceptedTurnTransaction
  | SendThreadMessageQueuedTransaction;

export interface ReorderQueuedMessageTransaction {
  previousQueuedMessages: ThreadQueuedMessageListResponse | undefined;
}

export interface CreateQueuedMessageTransaction {
  optimisticQueuedMessageId: string;
  previousQueuedMessages: ThreadQueuedMessageListResponse | undefined;
}

export interface RemoveQueuedMessageTransaction {
  optimisticRowId: string | null;
  previousQueuedMessages: ThreadQueuedMessageListResponse | undefined;
  previousThread: ThreadResponse | undefined;
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

function getCachedDefaultExecutionOptions(
  queryClient: QueryClient,
  threadId: string,
): ResolvedThreadExecutionOptions | null | undefined {
  return queryClient.getQueryData<ResolvedThreadExecutionOptions | null>(
    threadDefaultExecutionOptionsQueryKey(threadId),
  );
}

function buildOptimisticQueuedMessage({
  createdAt,
  queryClient,
  request,
}: BuildOptimisticQueuedMessageParams): ThreadQueuedMessage {
  const defaultExecutionOptions = getCachedDefaultExecutionOptions(
    queryClient,
    request.id,
  );

  return {
    id: `optimistic-queued-${nanoid()}`,
    content: request.input,
    model: request.model ?? defaultExecutionOptions?.model ?? "pending",
    reasoningLevel:
      request.reasoningLevel ??
      defaultExecutionOptions?.reasoningLevel ??
      "medium",
    permissionMode:
      request.permissionMode ??
      defaultExecutionOptions?.permissionMode ??
      "readonly",
    serviceTier:
      request.serviceTier ?? defaultExecutionOptions?.serviceTier ?? "default",
    createdAt,
    updatedAt: createdAt,
  };
}

function insertOptimisticQueuedMessage({
  queryClient,
  request,
}: CreateQueuedMessageTransactionArgs): CreateQueuedMessageTransaction {
  const queryKey = threadQueuedMessagesQueryKey(request.id);
  const previousQueuedMessages =
    queryClient.getQueryData<ThreadQueuedMessageListResponse>(queryKey);
  const optimisticQueuedMessage = buildOptimisticQueuedMessage({
    createdAt: Date.now(),
    queryClient,
    request,
  });

  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    queryKey,
    (currentQueuedMessages) => [
      ...(currentQueuedMessages ?? []),
      optimisticQueuedMessage,
    ],
  );

  return {
    optimisticQueuedMessageId: optimisticQueuedMessage.id,
    previousQueuedMessages,
  };
}

function restoreQueuedMessageSnapshot({
  previousQueuedMessages,
  queryClient,
  threadId,
}: {
  previousQueuedMessages: ThreadQueuedMessageListResponse | undefined;
  queryClient: QueryClient;
  threadId: string;
}): void {
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    threadQueuedMessagesQueryKey(threadId),
    previousQueuedMessages ?? [],
  );
}

function removeCachedQueuedMessage({
  queryClient,
  request,
}: RemoveQueuedMessageTransactionArgs): RemoveQueuedMessageTransaction {
  const queryKey = threadQueuedMessagesQueryKey(request.id);
  const previousQueuedMessages =
    queryClient.getQueryData<ThreadQueuedMessageListResponse>(queryKey);

  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    queryKey,
    (currentQueuedMessages) =>
      currentQueuedMessages?.filter(
        (queuedMessage) => queuedMessage.id !== request.queuedMessageId,
      ) ?? currentQueuedMessages,
  );

  return {
    optimisticRowId: null,
    previousQueuedMessages,
    previousThread: undefined,
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

function applyOptimisticAcceptedTurnThreadState({
  createdAt,
  queryClient,
  threadId,
}: {
  createdAt: number;
  queryClient: QueryClient;
  threadId: string;
}): void {
  updateCachedThread(queryClient, threadId, (thread) => ({
    ...thread,
    status: "active",
    updatedAt: Math.max(thread.updatedAt, createdAt),
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
  queryClient.setQueryData<ThreadResponse>(threadQueryKey(thread.id), thread);
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
    const queryKey = threadQueuedMessagesQueryKey(request.id);
    await queryClient.cancelQueries({
      queryKey,
    });
    const transaction = insertOptimisticQueuedMessage({
      queryClient,
      request,
    });
    return {
      kind: "queued-message",
      ...transaction,
    };
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

  applyOptimisticAcceptedTurnThreadState({
    createdAt: optimisticCreatedAt,
    queryClient,
    threadId: request.id,
  });

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
  if (transaction?.kind === "queued-message") {
    restoreQueuedMessageSnapshot({
      previousQueuedMessages: transaction.previousQueuedMessages,
      queryClient,
      threadId: request.id,
    });
    return;
  }
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

export async function beginCreateQueuedMessageTransaction({
  queryClient,
  request,
}: CreateQueuedMessageTransactionArgs): Promise<CreateQueuedMessageTransaction> {
  await queryClient.cancelQueries({
    queryKey: threadQueuedMessagesQueryKey(request.id),
  });
  return insertOptimisticQueuedMessage({ queryClient, request });
}

export function rollbackCreateQueuedMessageTransaction({
  queryClient,
  request,
  transaction,
}: RollbackCreateQueuedMessageTransactionArgs): void {
  if (!transaction) {
    return;
  }
  restoreQueuedMessageSnapshot({
    previousQueuedMessages: transaction.previousQueuedMessages,
    queryClient,
    threadId: request.id,
  });
}

export function applyQueuedMessageCreateResult({
  queryClient,
  queuedMessage,
  threadId,
  transaction,
}: QueuedMessageSuccessArgs): void {
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    threadQueuedMessagesQueryKey(threadId),
    (currentQueuedMessages) => {
      if (!currentQueuedMessages) {
        return [queuedMessage];
      }
      if (
        currentQueuedMessages.some(
          (currentQueuedMessage) =>
            currentQueuedMessage.id === queuedMessage.id,
        )
      ) {
        return currentQueuedMessages;
      }

      const optimisticQueuedMessageId =
        transaction?.optimisticQueuedMessageId ?? null;
      if (optimisticQueuedMessageId !== null) {
        const optimisticIndex = currentQueuedMessages.findIndex(
          (currentQueuedMessage) =>
            currentQueuedMessage.id === optimisticQueuedMessageId,
        );
        if (optimisticIndex !== -1) {
          const nextQueuedMessages = [...currentQueuedMessages];
          nextQueuedMessages[optimisticIndex] = queuedMessage;
          return nextQueuedMessages;
        }
      }

      return [...currentQueuedMessages, queuedMessage];
    },
  );
  prependThreadPromptHistory(
    queryClient,
    threadId,
    buildQueuedPromptHistoryEntry(queuedMessage),
  );
  invalidateThreadQueueQueries({ queryClient, threadId });
}

export async function beginRemoveQueuedMessageTransaction({
  queryClient,
  request,
}: RemoveQueuedMessageTransactionArgs): Promise<RemoveQueuedMessageTransaction> {
  await queryClient.cancelQueries({
    queryKey: threadQueuedMessagesQueryKey(request.id),
  });
  return removeCachedQueuedMessage({ queryClient, request });
}

export async function beginSendQueuedMessageTransaction({
  queryClient,
  request,
}: SendQueuedMessageTransactionArgs): Promise<RemoveQueuedMessageTransaction> {
  await Promise.all([
    queryClient.cancelQueries({
      queryKey: threadQueuedMessagesQueryKey(request.id),
    }),
    queryClient.cancelQueries({ queryKey: threadQueryKey(request.id) }),
    queryClient.cancelQueries({
      queryKey: threadTimelineQueryKeyPrefix(request.id),
    }),
    queryClient.cancelQueries({
      queryKey: threadTimelineTurnSummaryDetailsQueryKeyPrefix(request.id),
    }),
  ]);

  const previousQueuedMessages =
    queryClient.getQueryData<ThreadQueuedMessageListResponse>(
      threadQueuedMessagesQueryKey(request.id),
    );
  const queuedMessage = previousQueuedMessages?.find(
    (currentQueuedMessage) =>
      currentQueuedMessage.id === request.queuedMessageId,
  );
  const previousThread = queryClient.getQueryData<ThreadResponse>(
    threadQueryKey(request.id),
  );

  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    threadQueuedMessagesQueryKey(request.id),
    (currentQueuedMessages) =>
      currentQueuedMessages?.filter(
        (currentQueuedMessage) =>
          currentQueuedMessage.id !== request.queuedMessageId,
      ) ?? currentQueuedMessages,
  );

  if (!queuedMessage) {
    return {
      optimisticRowId: null,
      previousQueuedMessages,
      previousThread,
    };
  }

  const optimisticCreatedAt = Date.now();
  applyOptimisticAcceptedTurnThreadState({
    createdAt: optimisticCreatedAt,
    queryClient,
    threadId: request.id,
  });
  const optimisticRow = buildOptimisticUserMessageRow({
    createdAt: optimisticCreatedAt,
    input: queuedMessage.content,
    mode: request.mode,
    threadId: request.id,
    threadStatus: previousThread?.status ?? null,
  });
  insertOptimisticTimelineRow(queryClient, request.id, optimisticRow);

  return {
    optimisticRowId: optimisticRow.id,
    previousQueuedMessages,
    previousThread,
  };
}

export function rollbackRemoveQueuedMessageTransaction({
  queryClient,
  request,
  transaction,
}: RollbackRemoveQueuedMessageTransactionArgs): void {
  if (!transaction) {
    return;
  }
  if (transaction.optimisticRowId !== null) {
    removeOptimisticTimelineRow(
      queryClient,
      request.id,
      transaction.optimisticRowId,
    );
  }
  if (transaction.previousThread) {
    queryClient.setQueryData<ThreadResponse>(
      threadQueryKey(request.id),
      transaction.previousThread,
    );
  }
  restoreQueuedMessageSnapshot({
    previousQueuedMessages: transaction.previousQueuedMessages,
    queryClient,
    threadId: request.id,
  });
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
