import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ReorderPinnedThreadRequest,
  ThreadArchiveAllResponse,
  ThreadResponse,
  UpdateThreadRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { appToast } from "@/components/ui/app-toast";
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

/**
 * How long the "Thread archived — Undo" toast stays up. Matches the server's
 * archive grace window (`MANAGED_ENVIRONMENT_RETIRE_GRACE_MS`), within which an
 * Undo revives the environment losslessly (its worktree has not been destroyed
 * yet). After it elapses a destroyed managed environment can only be handed off
 * to a new thread from its surviving branch.
 */
const ARCHIVE_UNDO_TOAST_DURATION_MS = 10_000;

type UpdateThreadMutationRequest = ThreadMutationRequest & UpdateThreadRequest;
type ReorderPinnedThreadMutationRequest = ThreadMutationRequest &
  ReorderPinnedThreadRequest;
type UnpinAndMoveThreadMutationRequest = ThreadMutationRequest & {
  sectionId: string | null;
};

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
      sectionId,
      id,
      title,
    }): Promise<ThreadListMutationTransaction | undefined> | undefined => {
      if (title === undefined && sectionId === undefined) {
        return undefined;
      }

      return beginThreadMetadataTransaction({
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
    onSuccess: (data) => {
      // Offer a quick, lossless Undo while the environment is still inside its
      // grace window: un-archiving revives a retiring environment in place
      // (retire.cancelled), so the worktree and uncommitted work are preserved.
      const archivedThreadIds = data.archivedThreadIds;
      appToast.message("Thread archived", {
        action: {
          label: "Undo",
          onClick: () => {
            void Promise.all(
              archivedThreadIds.map((threadId) =>
                sdk.threads.unarchive({ threadId }),
              ),
            ).then(() => {
              for (const threadId of archivedThreadIds) {
                settleThreadListMembershipMutation({ queryClient, threadId });
              }
            });
          },
        },
        duration: ARCHIVE_UNDO_TOAST_DURATION_MS,
      });
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
    mutationFn: (threadId: string) => sdk.threads.markRead({ threadId }),
    onMutate: (threadId): Promise<ThreadListMutationTransaction> =>
      beginThreadReadStateTransaction({
        lastReadAt: Date.now(),
        queryClient,
        threadId,
      }),
    onError: (_error, threadId, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId,
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
    mutationFn: (threadId: string) => sdk.threads.markUnread({ threadId }),
    onMutate: (threadId): Promise<ThreadListMutationTransaction> =>
      beginThreadReadStateTransaction({
        lastReadAt: null,
        queryClient,
        threadId,
      }),
    onError: (_error, threadId, context) => {
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId,
        transaction: context,
      });
    },
    onSuccess: (thread) => {
      applyThreadReadStateResult({ queryClient, thread });
    },
  });
}
