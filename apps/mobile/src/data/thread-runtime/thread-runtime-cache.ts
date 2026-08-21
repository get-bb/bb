import {
  OPTIMISTIC_TIMELINE_ROW_ID_PREFIX,
  type SendMessageMutationRequest,
} from "@bb/client-core";
import type {
  PromptInput,
  ThreadQueuedMessage,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type {
  CreateQueuedMessageRequest,
  SendQueuedMessageMode,
  ThreadQueuedMessageListResponse,
  ThreadResponse,
  ThreadTimelineResponse,
  TimelineConversationAttachments,
  TimelineRow,
  UpdateQueuedMessageRequest,
} from "@bb/server-contract";
import type { QueryClient } from "@tanstack/react-query";
import {
  sidebarNavigationQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadSearchQueryKeyPrefix,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKeyPrefix,
  threadsQueryKey,
} from "@/lib/query/query-keys";
import {
  applyToCachedThreadLists,
  applyToCachedThreadListsAndSidebar,
  restoreThreadListCaches,
  snapshotThreadListCaches,
  type ThreadListCacheSnapshot,
} from "../threads/thread-list-cache";
import {
  applyQueuedMessageGroupBoundary,
  applyQueuedMessageReorder,
  collectLeadQueuedMessageGroupIds,
  preserveLeadQueuedMessageGroupAfterReorder,
  queuedMessageSendGroup,
  removeQueuedMessagesAndRepairGroupEdges,
  type QueuedMessageReorderRequest,
} from "./queued-message-order";

/**
 * Optimistic thread-runtime transactions (mirrors
 * apps/app/src/hooks/cache-owners/thread-runtime-cache-owner.ts): sending a
 * follow-up (an optimistic user row in the timeline window, or an optimistic
 * queued message when the thread is active), the queue mutations, and stop.
 * Each `begin*` snapshots what `rollback*` needs; `apply*` writes the
 * server's result and invalidates what realtime may not echo.
 *
 * Mobile keeps one timeline window per thread (`threadTimelineQueryKey`), no
 * prompt-history queries, and no cached default execution options, so those
 * parts of the web owner have no counterpart here.
 */

export type SendThreadMessageRequest = SendMessageMutationRequest;

export interface CreateQueuedMessageRequestWithThreadId extends CreateQueuedMessageRequest {
  id: string;
}

export interface UpdateQueuedMessageRequestWithThreadId extends UpdateQueuedMessageRequest {
  id: string;
  queuedMessageId: string;
}

export interface RemoveQueuedMessageRequest {
  id: string;
  queuedMessageId: string;
}

export interface SendQueuedMessageRequestWithThreadId extends RemoveQueuedMessageRequest {
  mode: SendQueuedMessageMode;
}

export interface ReorderQueuedMessageRequestWithThreadId extends QueuedMessageReorderRequest {
  id: string;
}

export interface SetQueuedMessageGroupBoundaryRequestWithThreadId {
  expectedGroupedPrefixQueuedMessageIds: string[];
  groupBoundaryQueuedMessageId: string;
  id: string;
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

export interface CreateQueuedMessageTransaction {
  optimisticQueuedMessageId: string;
  previousQueuedMessages: ThreadQueuedMessageListResponse | undefined;
}

export interface UpdateQueuedMessageTransaction {
  optimisticUpdatedAt: number | null;
  previousQueuedMessage: ThreadQueuedMessage | undefined;
}

export interface RemoveQueuedMessageTransaction {
  optimisticRowId: string | null;
  previousQueuedMessages: ThreadQueuedMessageListResponse | undefined;
  previousThread: ThreadResponse | undefined;
}

export interface ReorderQueuedMessageTransaction {
  previousQueuedMessages: ThreadQueuedMessageListResponse | undefined;
}

export interface StopThreadTransaction {
  previousThread: ThreadResponse | undefined;
  previousLists: ThreadListCacheSnapshot;
}

interface ThreadIdArgs {
  queryClient: QueryClient;
  threadId: string;
}

// --- Ids -------------------------------------------------------------------

function randomSuffix(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function createOptimisticTimelineRowId(): string {
  return `${OPTIMISTIC_TIMELINE_ROW_ID_PREFIX}${randomSuffix()}`;
}

const OPTIMISTIC_QUEUED_MESSAGE_ID_PREFIX = "optimistic-queued-";

// --- Thread cache ------------------------------------------------------------

function updateCachedThread(
  queryClient: QueryClient,
  threadId: string,
  updater: (thread: ThreadResponse) => ThreadResponse,
): void {
  queryClient.setQueryData<ThreadResponse>(
    threadQueryKey(threadId),
    (thread) => (thread === undefined ? thread : updater(thread)),
  );
}

function isHostBlockedDisplayStatus(
  status: ThreadRuntimeDisplayStatus,
): boolean {
  return status === "host-reconnecting" || status === "waiting-for-host";
}

/**
 * Flip the thread to `active` so the working indicator mounts with the
 * optimistic user row. Host blockers are preserved: promoting them would
 * misrepresent host readiness.
 */
function applyOptimisticAcceptedTurnThreadState({
  createdAt,
  queryClient,
  threadId,
}: ThreadIdArgs & { createdAt: number }): void {
  updateCachedThread(queryClient, threadId, (thread) => ({
    ...thread,
    status: "active",
    updatedAt: Math.max(thread.updatedAt, createdAt),
    runtime: {
      ...thread.runtime,
      displayStatus: isHostBlockedDisplayStatus(thread.runtime.displayStatus)
        ? thread.runtime.displayStatus
        : "active",
    },
  }));
}

// --- Timeline rows -----------------------------------------------------------

function insertOptimisticTimelineRow(
  queryClient: QueryClient,
  threadId: string,
  row: TimelineRow,
): void {
  queryClient.setQueryData<ThreadTimelineResponse>(
    threadTimelineQueryKey(threadId),
    (timeline) =>
      timeline === undefined
        ? timeline
        : { ...timeline, rows: [...timeline.rows, row] },
  );
}

function removeOptimisticTimelineRow(
  queryClient: QueryClient,
  threadId: string,
  rowId: string,
): void {
  queryClient.setQueryData<ThreadTimelineResponse>(
    threadTimelineQueryKey(threadId),
    (timeline) => {
      if (timeline === undefined) return timeline;
      const rows = timeline.rows.filter((row) => row.id !== rowId);
      return rows.length === timeline.rows.length
        ? timeline
        : { ...timeline, rows };
    },
  );
}

type OptimisticTurnRequestKind = "message" | "steer";

function optimisticTurnRequestKind({
  mode,
  threadStatus,
}: {
  mode: SendThreadMessageRequest["mode"];
  threadStatus: ThreadResponse["status"] | null;
}): OptimisticTurnRequestKind {
  if (mode === "steer" || mode === "steer-if-active") return "steer";
  if (mode === "auto" && threadStatus === "active") return "steer";
  return "message";
}

function collectTimelineAttachments(
  input: readonly PromptInput[],
): TimelineConversationAttachments | null {
  const attachments: TimelineConversationAttachments = {
    webImages: 0,
    localImages: 0,
    localFiles: 0,
    imageUrls: [],
    localImagePaths: [],
    localFilePaths: [],
  };
  for (const entry of input) {
    switch (entry.type) {
      case "text":
        break;
      case "image":
        attachments.webImages += 1;
        attachments.imageUrls.push(entry.url);
        break;
      case "localImage":
        attachments.localImages += 1;
        attachments.localImagePaths.push(entry.path);
        break;
      case "localFile":
        attachments.localFiles += 1;
        attachments.localFilePaths.push(entry.path);
        break;
    }
  }
  return attachments.webImages +
    attachments.localImages +
    attachments.localFiles >
    0
    ? attachments
    : null;
}

/**
 * The user row a send renders before the server's row exists. The web leaves
 * `mentions` empty; with a single visible text chunk the authored offsets are
 * valid as-is, so they are kept and the pills render immediately.
 */
export function buildOptimisticUserMessageRow({
  createdAt,
  input,
  mode,
  threadId,
  threadStatus,
}: {
  createdAt: number;
  input: readonly PromptInput[];
  mode: SendThreadMessageRequest["mode"];
  threadId: string;
  threadStatus: ThreadResponse["status"] | null;
}): TimelineRow {
  const textChunks = input.filter(
    (entry): entry is Extract<PromptInput, { type: "text" }> =>
      entry.type === "text" && entry.visibility !== "agent-only",
  );
  const text = textChunks.map((entry) => entry.text).join("\n\n");
  const mentions =
    textChunks.length === 1 ? (textChunks[0]?.mentions ?? []) : [];
  return {
    id: createOptimisticTimelineRowId(),
    kind: "conversation",
    role: "user",
    threadId,
    turnId: null,
    sourceSeqStart: 0,
    sourceSeqEnd: 0,
    startedAt: createdAt,
    createdAt,
    text,
    mentions,
    attachments: collectTimelineAttachments(input),
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: {
      isGrouped: false,
      kind: optimisticTurnRequestKind({ mode, threadStatus }),
      status: "pending",
    },
  };
}

// --- Stop requested row --------------------------------------------------------

function hasConfirmedStopRow(rows: readonly TimelineRow[]): boolean {
  return rows.some(
    (row) =>
      row.kind === "system" &&
      row.systemKind === "operation" &&
      row.operationKind === "thread-interrupted",
  );
}

function buildStopRequestedTimelineRow({
  stoppingAnchorAt,
  threadId,
}: {
  stoppingAnchorAt: number;
  threadId: string;
}): TimelineRow {
  return {
    id: `${threadId}:pending-stop`,
    threadId,
    turnId: null,
    sourceSeqStart: 0,
    sourceSeqEnd: 0,
    startedAt: stoppingAnchorAt,
    createdAt: stoppingAnchorAt,
    kind: "system",
    systemKind: "operation",
    operationKind: "thread-interrupted",
    title: "Stop requested",
    detail: null,
    status: "pending",
    completedAt: null,
  };
}

/**
 * Rows with the client-only "Stop requested" system row appended while the
 * thread is `stopping` and the server has not yet written its own
 * `thread-interrupted` row (mirrors the web's `useTimelineRowsWithPendingStop`).
 * Apply at projection time, not in the cache: the row must vanish the moment
 * the server's row arrives.
 */
export function appendPendingStopRow(
  rows: readonly TimelineRow[],
  {
    isStopping,
    stoppingAnchorAt,
    threadId,
  }: { isStopping: boolean; stoppingAnchorAt: number; threadId: string },
): readonly TimelineRow[] {
  if (!isStopping || hasConfirmedStopRow(rows)) return rows;
  return [
    ...rows,
    buildStopRequestedTimelineRow({ stoppingAnchorAt, threadId }),
  ];
}

// --- Invalidation ----------------------------------------------------------------

function invalidateThreadListsAndSidebar(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  void queryClient.invalidateQueries({
    queryKey: threadSearchQueryKeyPrefix(),
  });
}

function invalidateThreadQueueQueries(
  queryClient: QueryClient,
  threadId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  void queryClient.invalidateQueries({
    queryKey: threadQueuedMessagesQueryKey(threadId),
  });
}

function invalidateThreadTimeline(
  queryClient: QueryClient,
  threadId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: threadTimelineQueryKey(threadId),
  });
  void queryClient.invalidateQueries({
    queryKey: threadTimelineTurnSummaryDetailsQueryKeyPrefix(threadId),
  });
}

/**
 * The next turn inherits the options of the last accepted run, so an
 * accepted message (or a rewrite) changes what the composer shows.
 */
function invalidateThreadDefaultExecutionOptions(
  queryClient: QueryClient,
  threadId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: threadDefaultExecutionOptionsQueryKey(threadId),
  });
}

/** Thread + timeline + lists: what a send/stop/banner action may change. */
function invalidateThreadActivityQueries(
  queryClient: QueryClient,
  threadId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  invalidateThreadTimeline(queryClient, threadId);
  invalidateThreadListsAndSidebar(queryClient);
}

/** Everything a history rewrite (edit message) can change. */
export function invalidateThreadHistoryRewriteQueries(
  queryClient: QueryClient,
  threadId: string,
): void {
  invalidateThreadActivityQueries(queryClient, threadId);
  invalidateThreadQueueQueries(queryClient, threadId);
  invalidateThreadDefaultExecutionOptions(queryClient, threadId);
}

// --- Send message ---------------------------------------------------------------

function requestWillQueueForActiveThread(
  request: SendThreadMessageRequest,
  thread: ThreadResponse | undefined,
): boolean {
  return request.mode === "queue-if-active" && thread?.status === "active";
}

export async function beginSendThreadMessageTransaction({
  queryClient,
  request,
}: {
  queryClient: QueryClient;
  request: SendThreadMessageRequest;
}): Promise<SendThreadMessageTransaction> {
  await queryClient.cancelQueries({ queryKey: threadQueryKey(request.id) });
  const previousThread = queryClient.getQueryData<ThreadResponse>(
    threadQueryKey(request.id),
  );
  if (requestWillQueueForActiveThread(request, previousThread)) {
    await queryClient.cancelQueries({
      queryKey: threadQueuedMessagesQueryKey(request.id),
    });
    return {
      kind: "queued-message",
      ...insertOptimisticQueuedMessage({ queryClient, request }),
    };
  }

  await Promise.all([
    queryClient.cancelQueries({
      queryKey: threadTimelineQueryKey(request.id),
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
}: {
  queryClient: QueryClient;
  request: SendThreadMessageRequest;
  transaction: SendThreadMessageTransaction | undefined;
}): void {
  if (!transaction) return;
  if (transaction.kind === "queued-message") {
    restoreQueuedMessageSnapshot({
      previousQueuedMessages: transaction.previousQueuedMessages,
      queryClient,
      threadId: request.id,
    });
    return;
  }
  removeOptimisticTimelineRow(
    queryClient,
    request.id,
    transaction.optimisticRowId,
  );
  if (transaction.previousThread) {
    queryClient.setQueryData<ThreadResponse>(
      threadQueryKey(request.id),
      transaction.previousThread,
    );
  }
}

/**
 * After the server accepted the send. With realtime connected the
 * `events-appended` / `status-changed` stream brings the real rows and
 * drops the optimistic one; without it, refetch explicitly.
 */
export function applySendThreadMessageSuccess({
  queryClient,
  realtimeConnected,
  request,
  transaction,
}: {
  queryClient: QueryClient;
  realtimeConnected: boolean;
  request: SendThreadMessageRequest;
  transaction: SendThreadMessageTransaction | undefined;
}): void {
  if (transaction?.kind === "queued-message") {
    invalidateThreadQueueQueries(queryClient, request.id);
    return;
  }
  invalidateThreadDefaultExecutionOptions(queryClient, request.id);
  if (!realtimeConnected) {
    invalidateThreadActivityQueries(queryClient, request.id);
  }
}

// --- Queued messages --------------------------------------------------------------

function buildOptimisticQueuedMessage({
  createdAt,
  request,
}: {
  createdAt: number;
  request: CreateQueuedMessageRequestWithThreadId;
}): ThreadQueuedMessage {
  return {
    id: `${OPTIMISTIC_QUEUED_MESSAGE_ID_PREFIX}${randomSuffix()}`,
    content: request.input,
    model: request.model ?? "pending",
    reasoningLevel: request.reasoningLevel ?? "medium",
    permissionMode: request.permissionMode ?? "auto",
    serviceTier: request.serviceTier ?? "default",
    groupWithNext: false,
    createdAt,
    updatedAt: createdAt,
  };
}

function insertOptimisticQueuedMessage({
  queryClient,
  request,
}: {
  queryClient: QueryClient;
  request: CreateQueuedMessageRequestWithThreadId;
}): CreateQueuedMessageTransaction {
  const queryKey = threadQueuedMessagesQueryKey(request.id);
  const previousQueuedMessages =
    queryClient.getQueryData<ThreadQueuedMessageListResponse>(queryKey);
  const optimistic = buildOptimisticQueuedMessage({
    createdAt: Date.now(),
    request,
  });
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    queryKey,
    (current) => [...(current ?? []), optimistic],
  );
  return { optimisticQueuedMessageId: optimistic.id, previousQueuedMessages };
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

export async function beginCreateQueuedMessageTransaction({
  queryClient,
  request,
}: {
  queryClient: QueryClient;
  request: CreateQueuedMessageRequestWithThreadId;
}): Promise<CreateQueuedMessageTransaction> {
  await queryClient.cancelQueries({
    queryKey: threadQueuedMessagesQueryKey(request.id),
  });
  return insertOptimisticQueuedMessage({ queryClient, request });
}

export function rollbackCreateQueuedMessageTransaction({
  queryClient,
  threadId,
  transaction,
}: ThreadIdArgs & {
  transaction: CreateQueuedMessageTransaction | undefined;
}): void {
  if (!transaction) return;
  restoreQueuedMessageSnapshot({
    previousQueuedMessages: transaction.previousQueuedMessages,
    queryClient,
    threadId,
  });
}

/** Replace the optimistic entry with the server's (or append / dedupe). */
export function applyQueuedMessageCreateResult({
  queryClient,
  queuedMessage,
  threadId,
  transaction,
}: ThreadIdArgs & {
  queuedMessage: ThreadQueuedMessage;
  transaction: CreateQueuedMessageTransaction | undefined;
}): void {
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    threadQueuedMessagesQueryKey(threadId),
    (current) => {
      if (!current) return [queuedMessage];
      if (current.some((candidate) => candidate.id === queuedMessage.id)) {
        return current;
      }
      const optimisticId = transaction?.optimisticQueuedMessageId ?? null;
      if (optimisticId !== null) {
        const index = current.findIndex(
          (candidate) => candidate.id === optimisticId,
        );
        if (index !== -1) {
          const next = [...current];
          next[index] = queuedMessage;
          return next;
        }
      }
      return [...current, queuedMessage];
    },
  );
  invalidateThreadQueueQueries(queryClient, threadId);
}

export async function beginUpdateQueuedMessageTransaction({
  queryClient,
  request,
}: {
  queryClient: QueryClient;
  request: UpdateQueuedMessageRequestWithThreadId;
}): Promise<UpdateQueuedMessageTransaction> {
  const queryKey = threadQueuedMessagesQueryKey(request.id);
  await queryClient.cancelQueries({ queryKey });
  const previousQueuedMessage = queryClient
    .getQueryData<ThreadQueuedMessageListResponse>(queryKey)
    ?.find((queuedMessage) => queuedMessage.id === request.queuedMessageId);
  const optimisticUpdatedAt = previousQueuedMessage
    ? Math.max(Date.now(), previousQueuedMessage.updatedAt + 1)
    : null;
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    queryKey,
    (current) =>
      current?.map((queuedMessage) =>
        queuedMessage.id === request.queuedMessageId
          ? {
              ...queuedMessage,
              content: request.input,
              updatedAt: optimisticUpdatedAt ?? queuedMessage.updatedAt,
            }
          : queuedMessage,
      ),
  );
  return { optimisticUpdatedAt, previousQueuedMessage };
}

export function rollbackUpdateQueuedMessageTransaction({
  queryClient,
  request,
  transaction,
}: {
  queryClient: QueryClient;
  request: UpdateQueuedMessageRequestWithThreadId;
  transaction: UpdateQueuedMessageTransaction | undefined;
}): void {
  const previous = transaction?.previousQueuedMessage;
  const optimisticUpdatedAt = transaction?.optimisticUpdatedAt;
  if (previous !== undefined && optimisticUpdatedAt != null) {
    queryClient.setQueryData<ThreadQueuedMessageListResponse>(
      threadQueuedMessagesQueryKey(request.id),
      (current) =>
        current?.map((queuedMessage) =>
          queuedMessage.id === request.queuedMessageId &&
          queuedMessage.updatedAt === optimisticUpdatedAt
            ? {
                ...queuedMessage,
                content: previous.content,
                updatedAt: previous.updatedAt,
              }
            : queuedMessage,
        ),
    );
  }
  invalidateThreadQueueQueries(queryClient, request.id);
}

export function applyQueuedMessageUpdateResult({
  queryClient,
  queuedMessage,
  threadId,
}: ThreadIdArgs & { queuedMessage: ThreadQueuedMessage }): void {
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    threadQueuedMessagesQueryKey(threadId),
    (current) =>
      current?.map((candidate) =>
        candidate.id === queuedMessage.id ? queuedMessage : candidate,
      ) ?? [queuedMessage],
  );
  invalidateThreadQueueQueries(queryClient, threadId);
}

export async function beginRemoveQueuedMessageTransaction({
  queryClient,
  request,
}: {
  queryClient: QueryClient;
  request: RemoveQueuedMessageRequest;
}): Promise<RemoveQueuedMessageTransaction> {
  const queryKey = threadQueuedMessagesQueryKey(request.id);
  await queryClient.cancelQueries({ queryKey });
  const previousQueuedMessages =
    queryClient.getQueryData<ThreadQueuedMessageListResponse>(queryKey);
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    queryKey,
    (current) =>
      removeQueuedMessagesAndRepairGroupEdges(
        current,
        new Set([request.queuedMessageId]),
      ),
  );
  return {
    optimisticRowId: null,
    previousQueuedMessages,
    previousThread: undefined,
  };
}

/**
 * Send-now: the message (or, for the lead message, its whole group) leaves
 * the queue at once; a single message also gets an optimistic user row and
 * the thread flips to active.
 */
export async function beginSendQueuedMessageTransaction({
  queryClient,
  request,
}: {
  queryClient: QueryClient;
  request: SendQueuedMessageRequestWithThreadId;
}): Promise<RemoveQueuedMessageTransaction> {
  await Promise.all([
    queryClient.cancelQueries({
      queryKey: threadQueuedMessagesQueryKey(request.id),
    }),
    queryClient.cancelQueries({ queryKey: threadQueryKey(request.id) }),
    queryClient.cancelQueries({
      queryKey: threadTimelineQueryKey(request.id),
    }),
    queryClient.cancelQueries({
      queryKey: threadTimelineTurnSummaryDetailsQueryKeyPrefix(request.id),
    }),
  ]);
  const previousQueuedMessages =
    queryClient.getQueryData<ThreadQueuedMessageListResponse>(
      threadQueuedMessagesQueryKey(request.id),
    );
  const group = queuedMessageSendGroup(
    previousQueuedMessages,
    request.queuedMessageId,
  );
  const sendIds =
    group.length === 0
      ? new Set([request.queuedMessageId])
      : new Set(group.map((queuedMessage) => queuedMessage.id));
  const previousThread = queryClient.getQueryData<ThreadResponse>(
    threadQueryKey(request.id),
  );
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    threadQueuedMessagesQueryKey(request.id),
    (current) => removeQueuedMessagesAndRepairGroupEdges(current, sendIds),
  );

  const queuedMessage = group[0] ?? null;
  if (!queuedMessage) {
    return { optimisticRowId: null, previousQueuedMessages, previousThread };
  }
  const optimisticCreatedAt = Date.now();
  applyOptimisticAcceptedTurnThreadState({
    createdAt: optimisticCreatedAt,
    queryClient,
    threadId: request.id,
  });
  if (group.length > 1) {
    return { optimisticRowId: null, previousQueuedMessages, previousThread };
  }
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
  threadId,
  transaction,
}: ThreadIdArgs & {
  transaction: RemoveQueuedMessageTransaction | undefined;
}): void {
  if (!transaction) return;
  if (transaction.optimisticRowId !== null) {
    removeOptimisticTimelineRow(
      queryClient,
      threadId,
      transaction.optimisticRowId,
    );
  }
  if (transaction.previousThread) {
    queryClient.setQueryData<ThreadResponse>(
      threadQueryKey(threadId),
      transaction.previousThread,
    );
  }
  restoreQueuedMessageSnapshot({
    previousQueuedMessages: transaction.previousQueuedMessages,
    queryClient,
    threadId,
  });
}

export function applyQueuedMessageSendResult(
  queryClient: QueryClient,
  threadId: string,
): void {
  invalidateThreadQueueQueries(queryClient, threadId);
  invalidateThreadActivityQueries(queryClient, threadId);
}

export function applyQueuedMessageDeleteResult(
  queryClient: QueryClient,
  threadId: string,
): void {
  invalidateThreadQueueQueries(queryClient, threadId);
}

/**
 * Reorder is applied synchronously (before the cancel await) so the list
 * re-renders in its new order in the same tick as the tap.
 */
export async function beginReorderQueuedMessageTransaction({
  queryClient,
  request,
}: {
  queryClient: QueryClient;
  request: ReorderQueuedMessageRequestWithThreadId;
}): Promise<ReorderQueuedMessageTransaction> {
  const queryKey = threadQueuedMessagesQueryKey(request.id);
  const previousQueuedMessages =
    queryClient.getQueryData<ThreadQueuedMessageListResponse>(queryKey);
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    queryKey,
    (current) => {
      if (!current) return current;
      const originalLeadGroupIds = collectLeadQueuedMessageGroupIds(current);
      const reordered = applyQueuedMessageReorder(current, request);
      return request.groupBoundaryQueuedMessageId !== undefined
        ? applyQueuedMessageGroupBoundary(
            reordered,
            request.groupBoundaryQueuedMessageId,
          )
        : preserveLeadQueuedMessageGroupAfterReorder(
            reordered,
            originalLeadGroupIds,
          );
    },
  );
  await queryClient.cancelQueries({ queryKey });
  return { previousQueuedMessages };
}

export async function beginSetQueuedMessageGroupBoundaryTransaction({
  queryClient,
  request,
}: {
  queryClient: QueryClient;
  request: SetQueuedMessageGroupBoundaryRequestWithThreadId;
}): Promise<ReorderQueuedMessageTransaction> {
  const queryKey = threadQueuedMessagesQueryKey(request.id);
  const previousQueuedMessages =
    queryClient.getQueryData<ThreadQueuedMessageListResponse>(queryKey);
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    queryKey,
    (current) =>
      current
        ? applyQueuedMessageGroupBoundary(
            current,
            request.groupBoundaryQueuedMessageId,
          )
        : current,
  );
  await queryClient.cancelQueries({ queryKey });
  return { previousQueuedMessages };
}

export function rollbackReorderQueuedMessageTransaction({
  queryClient,
  threadId,
  transaction,
}: ThreadIdArgs & {
  transaction: ReorderQueuedMessageTransaction | undefined;
}): void {
  if (transaction?.previousQueuedMessages !== undefined) {
    queryClient.setQueryData<ThreadQueuedMessageListResponse>(
      threadQueuedMessagesQueryKey(threadId),
      transaction.previousQueuedMessages,
    );
  }
  invalidateThreadQueueQueries(queryClient, threadId);
}

/** The reorder / group-boundary routes return the full ordered list. */
export function applyQueuedMessageListResult({
  queryClient,
  queuedMessages,
  threadId,
}: ThreadIdArgs & { queuedMessages: ThreadQueuedMessageListResponse }): void {
  queryClient.setQueryData<ThreadQueuedMessageListResponse>(
    threadQueuedMessagesQueryKey(threadId),
    queuedMessages,
  );
  invalidateThreadQueueQueries(queryClient, threadId);
}

// --- Stop ------------------------------------------------------------------------

export async function beginStopThreadTransaction({
  queryClient,
  requestedAt,
  threadId,
}: ThreadIdArgs & { requestedAt: number }): Promise<StopThreadTransaction> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: threadQueryKey(threadId) }),
    queryClient.cancelQueries({ queryKey: threadsQueryKey() }),
    queryClient.cancelQueries({ queryKey: sidebarNavigationQueryKey() }),
  ]);
  const previousThread = queryClient.getQueryData<ThreadResponse>(
    threadQueryKey(threadId),
  );
  const previousLists = snapshotThreadListCaches(queryClient);
  updateCachedThread(queryClient, threadId, (thread) => ({
    ...thread,
    status: "stopping",
    runtime: { ...thread.runtime, displayStatus: "stopping" },
    updatedAt: Math.max(thread.updatedAt, requestedAt),
  }));
  applyToCachedThreadLists(queryClient, (list) =>
    list.map((entry) =>
      entry.id === threadId
        ? {
            ...entry,
            status: "stopping",
            runtime: { ...entry.runtime, displayStatus: "stopping" },
            updatedAt: Math.max(entry.updatedAt, requestedAt),
          }
        : entry,
    ),
  );
  return { previousThread, previousLists };
}

export function rollbackStopThreadTransaction({
  queryClient,
  threadId,
  transaction,
}: ThreadIdArgs & { transaction: StopThreadTransaction | undefined }): void {
  if (!transaction) return;
  queryClient.setQueryData(
    threadQueryKey(threadId),
    transaction.previousThread,
  );
  restoreThreadListCaches(queryClient, transaction.previousLists);
}

export function settleStopThreadTransaction(
  queryClient: QueryClient,
  threadId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  invalidateThreadListsAndSidebar(queryClient);
}

// --- Plan / goal banners ------------------------------------------------------------

type ThreadBannerActivityKind = "goal" | "plan";

/**
 * Authoritative write after `POST /threads/:id/plan/cancel` or
 * `/goal/clear`: the timeline's active prompt mode / goal is gone and the
 * list activity counters drop to zero, ahead of the realtime echo.
 */
function applyThreadBannerCancellation({
  kind,
  queryClient,
  threadId,
}: ThreadIdArgs & { kind: ThreadBannerActivityKind }): void {
  queryClient.setQueryData<ThreadTimelineResponse>(
    threadTimelineQueryKey(threadId),
    (timeline) =>
      timeline === undefined
        ? timeline
        : {
            ...timeline,
            ...(kind === "plan" ? { activePromptMode: null } : { goal: null }),
          },
  );
  applyToCachedThreadListsAndSidebar(queryClient, (list) =>
    list.map((entry) =>
      entry.id === threadId
        ? {
            ...entry,
            activity: {
              ...entry.activity,
              ...(kind === "plan"
                ? { activePlanModeCount: 0 }
                : { activeGoalCount: 0 }),
            },
          }
        : entry,
    ),
  );
  invalidateThreadActivityQueries(queryClient, threadId);
}

export function applyThreadPlanCancellationResult(
  queryClient: QueryClient,
  threadId: string,
): void {
  applyThreadBannerCancellation({ kind: "plan", queryClient, threadId });
}

export function applyThreadGoalClearResult(
  queryClient: QueryClient,
  threadId: string,
): void {
  applyThreadBannerCancellation({ kind: "goal", queryClient, threadId });
}
