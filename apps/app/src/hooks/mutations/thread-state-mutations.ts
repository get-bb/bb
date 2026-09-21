import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@bb/domain";
import type {
  ReorderPinnedThreadRequest,
  ThreadArchiveAllResponse,
  ThreadResponse,
  UpdateThreadRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import type { LifecycleErrorOperation } from "@/lib/lifecycle-errors";
import {
  applyReorderPinnedThreadResult,
  applyThreadPinStateResult,
  applyThreadReadStateResult,
  applyThreadUpdateResult,
  beginArchiveThreadAndChildrenTransaction,
  beginDeleteThreadTransaction,
  beginPinThreadTransaction,
  beginThreadReadStateTransaction,
  beginThreadMetadataTransaction,
  beginReorderPinnedThreadTransaction,
  beginUnarchiveThreadTransaction,
  beginUnpinAndMoveThreadTransaction,
  beginUnpinThreadTransaction,
  rollbackArchiveThreadsTransaction,
  rollbackDeleteThreadTransaction,
  rollbackReorderPinnedThreadTransaction,
  rollbackThreadListMutationTransaction,
  rollbackThreadReadStateTransaction,
  type ThreadReadStateTransaction,
  settleArchiveThreadsTransaction,
  settleDeleteThreadTransaction,
  settleThreadListMembershipMutation,
  type ArchiveThreadsTransaction,
  type DeleteThreadTransaction,
  type PinnedThreadOrderTransaction,
  type ThreadListMutationTransaction,
} from "../cache-owners/thread-state-cache-owner";

interface ThreadMutationRequest {
  id: string;
}

type UpdateThreadMutationRequest = ThreadMutationRequest & UpdateThreadRequest;
type ReorderPinnedThreadMutationRequest = ThreadMutationRequest &
  ReorderPinnedThreadRequest;
type UnpinAndMoveThreadMutationRequest = ThreadMutationRequest & {
  sectionId: string | null;
};

interface MoveThreadToSectionRequest {
  sectionId: string | null;
  thread: Pick<Thread, "id" | "pinnedAt" | "sectionId">;
}

interface UpdateThreadMutationOptions {
  errorMessage?: string | undefined;
  lifecycleOperation?: LifecycleErrorOperation | undefined;
}

interface ArchiveThreadAndChildrenMutationRequest {
  id: string;
}

interface DeleteThreadMutationRequest {
  id: string;
  childThreadsConfirmed: boolean;
}

interface ThreadReadMutationInput {
  signal?: AbortSignal;
  threadId: string;
}

export function useUpdateThread(options?: UpdateThreadMutationOptions) {
  const queryClient = useQueryClient();

  return useMutation<
    ThreadResponse,
    Error,
    UpdateThreadMutationRequest,
    ThreadListMutationTransaction | undefined
  >({
    meta: {
      errorMessage: options?.errorMessage ?? "Failed to update thread.",
      ...(options?.lifecycleOperation
        ? { lifecycleOperation: options.lifecycleOperation }
        : {}),
    },
    mutationFn: ({ id, ...request }: UpdateThreadMutationRequest) =>
      sdk.threads.update({ threadId: id, ...request }),
    onMutate: ({
      parentThreadId,
      sectionId,
      id,
      title,
    }): Promise<ThreadListMutationTransaction | undefined> | undefined => {
      if (
        title === undefined &&
        sectionId === undefined &&
        parentThreadId === undefined
      ) {
        return undefined;
      }

      return beginThreadMetadataTransaction({
        parentThreadId,
        sectionId,
        queryClient,
        threadId: id,
        title,
      });
    },
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadUpdateResult({ queryClient, thread });
    },
  });
}

export function usePinThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to pin thread.",
    },
    mutationFn: ({ id }: ThreadMutationRequest) =>
      sdk.threads.pin({ threadId: id }),
    onMutate: async ({ id }): Promise<ThreadListMutationTransaction> =>
      beginPinThreadTransaction({
        pinnedAt: Date.now(),
        queryClient,
        threadId: id,
      }),
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadPinStateResult({ queryClient, thread, pinSortKey: null });
    },
    onSettled: (_data, _error, variables) => {
      settleThreadListMembershipMutation({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useUnpinThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to unpin thread.",
    },
    mutationFn: ({ id }: ThreadMutationRequest) =>
      sdk.threads.unpin({ threadId: id }),
    onMutate: async ({ id }): Promise<ThreadListMutationTransaction> =>
      beginUnpinThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadPinStateResult({ queryClient, thread, pinSortKey: null });
    },
    onSettled: (_data, _error, variables) => {
      settleThreadListMembershipMutation({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useUnpinAndMoveThread() {
  const queryClient = useQueryClient();

  return useMutation<
    ThreadResponse,
    Error,
    UnpinAndMoveThreadMutationRequest,
    ThreadListMutationTransaction
  >({
    meta: {
      errorMessage: "Failed to unpin and move thread.",
    },
    mutationFn: async ({ sectionId, id }) => {
      await sdk.threads.unpin({ threadId: id });
      return sdk.threads.update({ sectionId, threadId: id });
    },
    onMutate: async ({ sectionId, id }) =>
      beginUnpinAndMoveThreadTransaction({
        sectionId,
        queryClient,
        threadId: id,
      }),
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadPinStateResult({ queryClient, thread, pinSortKey: null });
    },
    onSettled: (_data, _error, variables) => {
      settleThreadListMembershipMutation({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useMoveThreadToSection() {
  const { mutate: updateThread } = useUpdateThread();
  const { mutate: unpinThread } = useUnpinThread();
  const { mutate: unpinAndMoveThread } = useUnpinAndMoveThread();

  return useCallback(
    ({ thread, sectionId }: MoveThreadToSectionRequest) => {
      if (thread.pinnedAt !== null) {
        if (thread.sectionId === sectionId) {
          unpinThread({ id: thread.id });
        } else {
          unpinAndMoveThread({ id: thread.id, sectionId });
        }
      } else if (thread.sectionId !== sectionId) {
        updateThread({ id: thread.id, sectionId });
      }
    },
    [unpinAndMoveThread, unpinThread, updateThread],
  );
}

export function useReorderPinnedThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reorder pinned threads.",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
      previousThreadId,
      nextThreadId,
    }: ReorderPinnedThreadMutationRequest) =>
      sdk.threads.reorderPinned({
        threadId: id,
        previousThreadId,
        nextThreadId,
      }),
    onMutate: async (request): Promise<PinnedThreadOrderTransaction> =>
      beginReorderPinnedThreadTransaction({ queryClient, request }),
    onError: (_error, _variables, context) => {
      rollbackReorderPinnedThreadTransaction({
        queryClient,
        transaction: context,
      });
    },
    onSuccess: (orderedRoots) => {
      applyReorderPinnedThreadResult({ orderedRoots, queryClient });
    },
  });
}

export function useArchiveThreadAndChildren() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to archive thread and children.",
      lifecycleOperation: "archive_thread",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
    }: ArchiveThreadAndChildrenMutationRequest): Promise<ThreadArchiveAllResponse> =>
      sdk.threads.archiveAll({ threadId: id }),
    onMutate: async ({ id }): Promise<ArchiveThreadsTransaction> =>
      beginArchiveThreadAndChildrenTransaction({
        queryClient,
        threadId: id,
      }),
    onError: (_error, _variables, context) => {
      rollbackArchiveThreadsTransaction({ queryClient, transaction: context });
    },
    onSettled: (data, _error, _variables, context) => {
      settleArchiveThreadsTransaction({
        queryClient,
        response: data,
        transaction: context,
      });
    },
  });
}

export function useUnarchiveThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["unarchive-thread"],
    meta: {
      errorMessage: "Failed to unarchive thread.",
    },
    mutationFn: async ({ id }: ThreadMutationRequest) => {
      await sdk.threads.unarchive({ threadId: id });
    },
    onMutate: async ({ id }): Promise<ThreadListMutationTransaction> =>
      beginUnarchiveThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, variables, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSettled: (_data, _error, variables) => {
      settleThreadListMembershipMutation({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to delete thread.",
    },
    mutationFn: async ({
      childThreadsConfirmed,
      id,
    }: DeleteThreadMutationRequest) => {
      await sdk.threads.delete({ childThreadsConfirmed, threadId: id });
    },
    onMutate: async ({ id }): Promise<DeleteThreadTransaction> =>
      beginDeleteThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, variables, context) => {
      rollbackDeleteThreadTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
    onSettled: (_data, _error, variables, context) => {
      settleDeleteThreadTransaction({
        queryClient,
        threadId: variables.id,
        transaction: context,
      });
    },
  });
}

export function useMarkThreadRead() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to mark thread read.",
      showErrorToast: false,
    },
    mutationFn: (input: ThreadReadMutationInput) => sdk.threads.markRead(input),
    onMutate: (input): Promise<ThreadReadStateTransaction> =>
      beginThreadReadStateTransaction({
        lastReadAt: Date.now(),
        queryClient,
        threadId: input.threadId,
      }),
    onError: (_error, input, context) => {
      rollbackThreadReadStateTransaction({
        queryClient,
        threadId: input.threadId,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadReadStateResult({ queryClient, thread });
    },
  });
}

export function useMarkThreadUnread() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to mark thread unread.",
      showErrorToast: false,
    },
    mutationFn: (input: ThreadReadMutationInput) =>
      sdk.threads.markUnread(input),
    onMutate: (input): Promise<ThreadListMutationTransaction> =>
      beginThreadReadStateTransaction({
        lastReadAt: null,
        queryClient,
        threadId: input.threadId,
      }),
    onError: (_error, input, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: input.threadId,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadReadStateResult({ queryClient, thread });
    },
  });
}
