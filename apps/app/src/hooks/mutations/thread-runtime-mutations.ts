import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ThreadQueuedMessage } from "@bb/domain";
import type {
  CreateQueuedMessageRequest,
  SendQueuedMessageMode,
  SendQueuedMessageResponse,
  ThreadQueuedMessageListResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import type { AppCreateThreadRequest } from "@/lib/api";
import { wsManager } from "@/lib/ws";
import type { QueuedMessageReorderRequest } from "@/lib/queued-message-reorder";
import type { SendThreadMessageMutationRequest } from "./mutation-request-types";
import {
  applyCreateThreadResult,
  applyQueuedMessageCreateResult,
  applyQueuedMessageDeleteResult,
  applyQueuedMessageReorderResult,
  applyQueuedMessageSendResult,
  applySendThreadMessageSuccess,
  beginCreateThreadTransaction,
  beginReorderQueuedMessageTransaction,
  beginSendThreadMessageTransaction,
  beginStopThreadTransaction,
  rollbackReorderQueuedMessageTransaction,
  rollbackSendThreadMessageTransaction,
  rollbackStopThreadTransaction,
  settleStopThreadTransaction,
  type ReorderQueuedMessageTransaction,
  type SendThreadMessageTransaction,
  type StopThreadTransaction,
} from "../cache-owners/thread-runtime-cache-owner";

interface CreateThreadQueuedMessageMutationRequest extends CreateQueuedMessageRequest {
  id: string;
}

interface SendThreadQueuedMessageMutationRequest {
  id: string;
  mode: SendQueuedMessageMode;
  queuedMessageId: string;
}

interface DeleteThreadQueuedMessageMutationRequest {
  id: string;
  queuedMessageId: string;
}

interface ReorderThreadQueuedMessageMutationRequest extends QueuedMessageReorderRequest {
  id: string;
}

export function useCreateThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to create thread.",
      lifecycleOperation: "create_thread",
    },
    mutationFn: (request: AppCreateThreadRequest) => api.createThread(request),
    onMutate: async () => beginCreateThreadTransaction({ queryClient }),
    onSuccess: (thread, variables) => {
      applyCreateThreadResult({
        queryClient,
        request: variables,
        thread,
      });
    },
  });
}

export function useSendThreadMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to send message.",
      lifecycleOperation: "send_message",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      input,
      model,
      serviceTier,
      reasoningLevel,
      permissionMode,
      mode,
      senderThreadId,
    }: SendThreadMessageMutationRequest) =>
      api.sendThreadMessage(id, {
        input,
        model,
        serviceTier,
        reasoningLevel,
        permissionMode,
        mode,
        // Non-null only for cross-thread sends (e.g. a side chat handing a
        // result back); the target renders it as "Message from {sender}".
        ...(senderThreadId !== undefined ? { senderThreadId } : {}),
      }),
    onMutate: async (variables): Promise<SendThreadMessageTransaction> =>
      beginSendThreadMessageTransaction({
        queryClient,
        request: variables,
      }),
    onError: (_error, variables, context) => {
      rollbackSendThreadMessageTransaction({
        queryClient,
        request: variables,
        transaction: context,
      });
    },
    onSuccess: (_data, variables, context) => {
      applySendThreadMessageSuccess({
        queryClient,
        realtimeConnected: wsManager.getConnectionState() === "connected",
        request: variables,
        transaction: context,
      });
    },
  });
}

export function useCreateThreadQueuedMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to queue message.",
      lifecycleOperation: "queue_message",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      input,
      model,
      serviceTier,
      reasoningLevel,
      permissionMode,
    }: CreateThreadQueuedMessageMutationRequest): Promise<ThreadQueuedMessage> =>
      api.createThreadQueuedMessage(id, {
        input,
        model,
        serviceTier,
        reasoningLevel,
        permissionMode,
      }),
    onSuccess: (queuedMessage, variables) => {
      applyQueuedMessageCreateResult({
        queryClient,
        queuedMessage,
        threadId: variables.id,
      });
    },
  });
}

export function useSendThreadQueuedMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to send queued message.",
      lifecycleOperation: "send_queued_message",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      mode,
      queuedMessageId,
    }: SendThreadQueuedMessageMutationRequest): Promise<SendQueuedMessageResponse> =>
      api.sendThreadQueuedMessage(id, queuedMessageId, { mode }),
    onSuccess: (_data, variables) => {
      applyQueuedMessageSendResult({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useReorderThreadQueuedMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reorder queued message.",
      lifecycleOperation: "reorder_queued_message",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      nextQueuedMessageId,
      previousQueuedMessageId,
      queuedMessageId,
    }: ReorderThreadQueuedMessageMutationRequest): Promise<ThreadQueuedMessageListResponse> =>
      api.reorderThreadQueuedMessage(id, queuedMessageId, {
        previousQueuedMessageId,
        nextQueuedMessageId,
      }),
    onMutate: async (variables): Promise<ReorderQueuedMessageTransaction> =>
      beginReorderQueuedMessageTransaction({
        queryClient,
        request: variables,
      }),
    onError: (_error, variables, context) => {
      rollbackReorderQueuedMessageTransaction({
        queryClient,
        request: variables,
        transaction: context,
      });
    },
    onSuccess: (queuedMessages, variables) => {
      applyQueuedMessageReorderResult({
        queryClient,
        queuedMessages,
        request: variables,
      });
    },
  });
}

export function useDeleteThreadQueuedMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to delete queued message.",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      queuedMessageId,
    }: DeleteThreadQueuedMessageMutationRequest) =>
      api.deleteThreadQueuedMessage(id, queuedMessageId),
    onSuccess: (_data, variables) => {
      applyQueuedMessageDeleteResult({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useStopThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to stop thread.",
      lifecycleOperation: "stop_thread",
    },
    mutationFn: (threadId: string) => api.stopThread(threadId),
    onMutate: async (threadId): Promise<StopThreadTransaction> =>
      beginStopThreadTransaction({
        queryClient,
        requestedAt: Date.now(),
        threadId,
      }),
    onError: (_error, threadId, context) => {
      rollbackStopThreadTransaction({
        queryClient,
        threadId,
        transaction: context,
      });
    },
    onSettled: (_data, _error, threadId) => {
      settleStopThreadTransaction({ queryClient, threadId });
    },
  });
}
