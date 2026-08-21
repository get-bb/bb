import type { ThreadQueuedMessage } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import type {
  EditMessageRequest,
  EditMessageResponse,
  SendQueuedMessageResponse,
  ThreadQueuedMessageListResponse,
} from "@bb/server-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { useSystemConfig } from "../system/system-queries";
import {
  applyQueuedMessageCreateResult,
  applyQueuedMessageDeleteResult,
  applyQueuedMessageListResult,
  applyQueuedMessageSendResult,
  applyQueuedMessageUpdateResult,
  applySendThreadMessageSuccess,
  applyThreadGoalClearResult,
  applyThreadPlanCancellationResult,
  beginCreateQueuedMessageTransaction,
  beginRemoveQueuedMessageTransaction,
  beginReorderQueuedMessageTransaction,
  beginSendQueuedMessageTransaction,
  beginSendThreadMessageTransaction,
  beginSetQueuedMessageGroupBoundaryTransaction,
  beginStopThreadTransaction,
  beginUpdateQueuedMessageTransaction,
  invalidateThreadHistoryRewriteQueries,
  rollbackCreateQueuedMessageTransaction,
  rollbackRemoveQueuedMessageTransaction,
  rollbackReorderQueuedMessageTransaction,
  rollbackSendThreadMessageTransaction,
  rollbackStopThreadTransaction,
  rollbackUpdateQueuedMessageTransaction,
  settleStopThreadTransaction,
  type CreateQueuedMessageRequestWithThreadId,
  type CreateQueuedMessageTransaction,
  type RemoveQueuedMessageRequest,
  type RemoveQueuedMessageTransaction,
  type ReorderQueuedMessageRequestWithThreadId,
  type ReorderQueuedMessageTransaction,
  type SendQueuedMessageRequestWithThreadId,
  type SendThreadMessageRequest,
  type SendThreadMessageTransaction,
  type SetQueuedMessageGroupBoundaryRequestWithThreadId,
  type StopThreadTransaction,
  type UpdateQueuedMessageRequestWithThreadId,
  type UpdateQueuedMessageTransaction,
} from "./thread-runtime-cache";

/**
 * Thread runtime mutations (mirrors
 * apps/app/src/hooks/mutations/thread-runtime-mutations.ts): send / edit /
 * stop / cancel plan / clear goal and the queued-message CRUD. Optimistic
 * writes and rollbacks live in `thread-runtime-cache.ts`. Send/queue errors
 * render inline in the composer (`showErrorToast: false`); stop and the
 * banner actions toast globally.
 */

export interface EditThreadMessageRequest extends EditMessageRequest {
  id: string;
}

function isQueuedMessageNotFoundError(error: unknown): boolean {
  if (!(error instanceof BbHttpError) || error.status !== 404) return false;
  const body: unknown = error.body;
  return (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    body.message === "Queued message not found"
  );
}

function useRealtimeConnected(): () => boolean {
  const { realtime } = useProfileClient();
  return () => realtime.getConnectionState() === "connected";
}

/**
 * `POST /threads/:id/send`. `mode` decides what an active thread does with
 * it (`queue-if-active` queues, `steer-if-active` interrupts, `auto` lets
 * the server pick); the optimistic transaction mirrors that choice.
 */
export function useSendThreadMessage() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  const realtimeConnected = useRealtimeConnected();
  return useMutation<
    void,
    Error,
    SendThreadMessageRequest,
    SendThreadMessageTransaction
  >({
    meta: { errorMessage: "Failed to send message.", showErrorToast: false },
    mutationFn: async ({ id, ...request }) => {
      await sdk.threads.send({ threadId: id, ...request });
    },
    onMutate: (request) =>
      beginSendThreadMessageTransaction({ queryClient, request }),
    onError: (_error, request, transaction) =>
      rollbackSendThreadMessageTransaction({
        queryClient,
        request,
        transaction,
      }),
    onSuccess: (_data, request, transaction) =>
      applySendThreadMessageSuccess({
        queryClient,
        realtimeConnected: realtimeConnected(),
        request,
        transaction,
      }),
  });
}

/**
 * `POST /threads/:id/edit-message` (behind the `editMessages` experiment,
 * see `useEditMessagesExperimentEnabled`): rewrites history from the edited
 * user message; `expectedRequestSequence` guards against a stale target.
 */
export function useEditThreadMessage() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  const realtimeConnected = useRealtimeConnected();
  return useMutation<EditMessageResponse, Error, EditThreadMessageRequest>({
    meta: {
      errorMessage: "Failed to edit the message.",
      showErrorToast: false,
    },
    mutationFn: ({ id, ...request }) =>
      sdk.threads.editMessage({ threadId: id, ...request }),
    onSuccess: (_result, { id }) => {
      // Realtime `history-rewritten` refetches everything; without it, do so.
      if (!realtimeConnected()) {
        invalidateThreadHistoryRewriteQueries(queryClient, id);
      }
    },
  });
}

/** Whether the server has the `editMessages` experiment switched on. */
export function useEditMessagesExperimentEnabled(): boolean {
  const config = useSystemConfig();
  return config.data?.experiments.editMessages ?? false;
}

/** `POST /threads/:id/stop`: the thread shows `stopping` at once. */
export function useStopThread() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string, StopThreadTransaction>({
    meta: { errorMessage: "Failed to stop thread." },
    mutationFn: async (threadId) => {
      await sdk.threads.stop({ threadId });
    },
    onMutate: (threadId) =>
      beginStopThreadTransaction({
        queryClient,
        requestedAt: Date.now(),
        threadId,
      }),
    onError: (_error, threadId, transaction) =>
      rollbackStopThreadTransaction({ queryClient, threadId, transaction }),
    onSettled: (_data, _error, threadId) =>
      settleStopThreadTransaction(queryClient, threadId),
  });
}

/** `POST /threads/:id/plan/cancel`: leave plan mode. */
export function useCancelThreadPlan() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    meta: { errorMessage: "Failed to exit Plan mode." },
    mutationFn: async (threadId) => {
      await sdk.threads.cancelPlan({ threadId });
    },
    onSuccess: (_data, threadId) =>
      applyThreadPlanCancellationResult(queryClient, threadId),
  });
}

/** `POST /threads/:id/goal/clear`. */
export function useClearThreadGoal() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    meta: { errorMessage: "Failed to clear Goal." },
    mutationFn: async (threadId) => {
      await sdk.threads.clearGoal({ threadId });
    },
    onSuccess: (_data, threadId) =>
      applyThreadGoalClearResult(queryClient, threadId),
  });
}

// --- Queued messages ------------------------------------------------------------

/** `POST /threads/:id/queued-messages`. */
export function useCreateThreadQueuedMessage() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadQueuedMessage,
    Error,
    CreateQueuedMessageRequestWithThreadId,
    CreateQueuedMessageTransaction
  >({
    meta: { errorMessage: "Failed to queue message.", showErrorToast: false },
    mutationFn: ({ id, ...request }) =>
      sdk.threads.queuedMessages.create({ threadId: id, ...request }),
    onMutate: (request) =>
      beginCreateQueuedMessageTransaction({ queryClient, request }),
    onError: (_error, { id }, transaction) =>
      rollbackCreateQueuedMessageTransaction({
        queryClient,
        threadId: id,
        transaction,
      }),
    onSuccess: (queuedMessage, { id }, transaction) =>
      applyQueuedMessageCreateResult({
        queryClient,
        queuedMessage,
        threadId: id,
        transaction,
      }),
  });
}

/** `PATCH /threads/:id/queued-messages/:qid` (content; `expectedUpdatedAt` guard). */
export function useUpdateThreadQueuedMessage() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadQueuedMessage,
    Error,
    UpdateQueuedMessageRequestWithThreadId,
    UpdateQueuedMessageTransaction
  >({
    meta: {
      errorMessage: "Failed to update queued message.",
      showErrorToast: false,
    },
    mutationFn: ({ id, queuedMessageId, expectedUpdatedAt, input }) =>
      sdk.threads.queuedMessages.update({
        threadId: id,
        queuedMessageId,
        expectedUpdatedAt,
        input,
      }),
    onMutate: (request) =>
      beginUpdateQueuedMessageTransaction({ queryClient, request }),
    onError: (_error, request, transaction) =>
      rollbackUpdateQueuedMessageTransaction({
        queryClient,
        request,
        transaction,
      }),
    onSuccess: (queuedMessage, { id }) =>
      applyQueuedMessageUpdateResult({
        queryClient,
        queuedMessage,
        threadId: id,
      }),
  });
}

/** `POST /threads/:id/queued-messages/:qid/send` ("Send now"). */
export function useSendThreadQueuedMessage() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    SendQueuedMessageResponse,
    Error,
    SendQueuedMessageRequestWithThreadId,
    RemoveQueuedMessageTransaction
  >({
    meta: {
      errorMessage: "Failed to send queued message.",
      showErrorToast: false,
    },
    mutationFn: ({ id, queuedMessageId, mode }) =>
      sdk.threads.queuedMessages.send({ threadId: id, queuedMessageId, mode }),
    onMutate: (request) =>
      beginSendQueuedMessageTransaction({ queryClient, request }),
    onError: (_error, { id }, transaction) =>
      rollbackRemoveQueuedMessageTransaction({
        queryClient,
        threadId: id,
        transaction,
      }),
    onSuccess: (_data, { id }) => applyQueuedMessageSendResult(queryClient, id),
  });
}

/** `DELETE /threads/:id/queued-messages/:qid` (a 404 counts as done). */
export function useDeleteThreadQueuedMessage() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    RemoveQueuedMessageRequest,
    RemoveQueuedMessageTransaction
  >({
    meta: {
      errorMessage: "Failed to delete queued message.",
      showErrorToast: false,
    },
    mutationFn: async ({ id, queuedMessageId }) => {
      try {
        await sdk.threads.queuedMessages.delete({
          threadId: id,
          queuedMessageId,
        });
      } catch (error) {
        if (isQueuedMessageNotFoundError(error)) return;
        throw error;
      }
    },
    onMutate: (request) =>
      beginRemoveQueuedMessageTransaction({ queryClient, request }),
    onError: (_error, { id }, transaction) =>
      rollbackRemoveQueuedMessageTransaction({
        queryClient,
        threadId: id,
        transaction,
      }),
    onSuccess: (_data, { id }) =>
      applyQueuedMessageDeleteResult(queryClient, id),
  });
}

/** `PATCH /threads/:id/queued-messages/:qid/order` (neighbour ids). */
export function useReorderThreadQueuedMessage() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadQueuedMessageListResponse,
    Error,
    ReorderQueuedMessageRequestWithThreadId,
    ReorderQueuedMessageTransaction
  >({
    meta: {
      errorMessage: "Failed to reorder queued message.",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      queuedMessageId,
      previousQueuedMessageId,
      nextQueuedMessageId,
      groupBoundaryQueuedMessageId,
    }) =>
      sdk.threads.queuedMessages.reorder({
        threadId: id,
        queuedMessageId,
        previousQueuedMessageId,
        nextQueuedMessageId,
        groupBoundaryQueuedMessageId,
      }),
    onMutate: (request) =>
      beginReorderQueuedMessageTransaction({ queryClient, request }),
    onError: (_error, { id }, transaction) =>
      rollbackReorderQueuedMessageTransaction({
        queryClient,
        threadId: id,
        transaction,
      }),
    onSuccess: (queuedMessages, { id }) =>
      applyQueuedMessageListResult({
        queryClient,
        queuedMessages,
        threadId: id,
      }),
  });
}

/** `PATCH /threads/:id/queued-messages/group-boundary`. */
export function useSetThreadQueuedMessageGroupBoundary() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadQueuedMessageListResponse,
    Error,
    SetQueuedMessageGroupBoundaryRequestWithThreadId,
    ReorderQueuedMessageTransaction
  >({
    meta: {
      errorMessage: "Failed to group queued messages.",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      expectedGroupedPrefixQueuedMessageIds,
      groupBoundaryQueuedMessageId,
    }) =>
      sdk.threads.queuedMessages.setGroupBoundary({
        threadId: id,
        expectedGroupedPrefixQueuedMessageIds,
        groupBoundaryQueuedMessageId,
      }),
    onMutate: (request) =>
      beginSetQueuedMessageGroupBoundaryTransaction({ queryClient, request }),
    onError: (_error, { id }, transaction) =>
      rollbackReorderQueuedMessageTransaction({
        queryClient,
        threadId: id,
        transaction,
      }),
    onSuccess: (queuedMessages, { id }) =>
      applyQueuedMessageListResult({
        queryClient,
        queuedMessages,
        threadId: id,
      }),
  });
}
