import type {
  ThreadArchiveAllResponse,
  ThreadResponse,
} from "@bb/server-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  applyThreadPinStateResult,
  applyThreadResult,
  beginArchiveThreadAndChildrenTransaction,
  beginDeleteThreadTransaction,
  beginPinThreadTransaction,
  beginThreadMetadataTransaction,
  beginThreadReadStateTransaction,
  beginUnarchiveThreadTransaction,
  beginUnpinThreadTransaction,
  invalidateThreadDetail,
  invalidateThreadLists,
  rollbackArchiveThreadsTransaction,
  rollbackThreadListMutation,
  settleArchiveThreadsTransaction,
  settleDeleteThreadTransaction,
  type ArchiveThreadsTransaction,
  type ThreadListMutationTransaction,
} from "./thread-state-cache";

/**
 * Thread state mutations (mirrors
 * apps/app/src/hooks/mutations/thread-state-mutations.ts): each applies its
 * optimistic patch to the detail cache, every cached list, and the sidebar
 * bootstrap, rolls back on error, and lets the server ordering win once the
 * request settles. `meta.errorMessage` feeds the profile QueryClient's global
 * mutation error toast; `showErrorToast: false` marks the ones whose callers
 * render the error inline.
 */

interface ThreadIdRequest {
  id: string;
}

export interface RenameThreadRequest extends ThreadIdRequest {
  /** `null` clears the custom title (falls back to the generated one). */
  title: string | null;
}

export interface MoveThreadToSectionRequest extends ThreadIdRequest {
  /** `null` moves the thread back to Unorganized. */
  sectionId: string | null;
}

export interface DeleteThreadRequest extends ThreadIdRequest {
  /**
   * The server refuses to delete a parent with live children unless the
   * caller confirmed; ask `sdk.threads.childSummary` first (see
   * `useThreadChildSummary`).
   */
  childThreadsConfirmed: boolean;
}

export function useRenameThread() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadResponse,
    Error,
    RenameThreadRequest,
    ThreadListMutationTransaction
  >({
    meta: { errorMessage: "Failed to rename thread." },
    mutationFn: ({ id, title }) => sdk.threads.update({ threadId: id, title }),
    onMutate: ({ id, title }) =>
      beginThreadMetadataTransaction({ queryClient, threadId: id, title }),
    onError: (_error, { id }, transaction) =>
      rollbackThreadListMutation({ queryClient, threadId: id }, transaction),
    onSuccess: (thread) => {
      applyThreadResult(queryClient, thread);
      invalidateThreadLists(queryClient);
    },
  });
}

export function useMoveThreadToSection() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadResponse,
    Error,
    MoveThreadToSectionRequest,
    ThreadListMutationTransaction
  >({
    meta: { errorMessage: "Failed to move thread." },
    mutationFn: ({ id, sectionId }) =>
      sdk.threads.update({ threadId: id, sectionId }),
    onMutate: ({ id, sectionId }) =>
      beginThreadMetadataTransaction({ queryClient, threadId: id, sectionId }),
    onError: (_error, { id }, transaction) =>
      rollbackThreadListMutation({ queryClient, threadId: id }, transaction),
    onSuccess: (thread) => {
      applyThreadResult(queryClient, thread);
      invalidateThreadLists(queryClient);
    },
  });
}

export function usePinThread() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadResponse,
    Error,
    ThreadIdRequest,
    ThreadListMutationTransaction
  >({
    meta: { errorMessage: "Failed to pin thread." },
    mutationFn: ({ id }) => sdk.threads.pin({ threadId: id }),
    onMutate: ({ id }) =>
      beginPinThreadTransaction({
        queryClient,
        threadId: id,
        pinnedAt: Date.now(),
      }),
    onError: (_error, { id }, transaction) =>
      rollbackThreadListMutation({ queryClient, threadId: id }, transaction),
    onSuccess: (thread) => applyThreadPinStateResult(queryClient, thread),
    onSettled: (_data, _error, { id }) => {
      invalidateThreadDetail(queryClient, id);
      invalidateThreadLists(queryClient);
    },
  });
}

export function useUnpinThread() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadResponse,
    Error,
    ThreadIdRequest,
    ThreadListMutationTransaction
  >({
    meta: { errorMessage: "Failed to unpin thread." },
    mutationFn: ({ id }) => sdk.threads.unpin({ threadId: id }),
    onMutate: ({ id }) =>
      beginUnpinThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, { id }, transaction) =>
      rollbackThreadListMutation({ queryClient, threadId: id }, transaction),
    onSuccess: (thread) => applyThreadPinStateResult(queryClient, thread),
    onSettled: (_data, _error, { id }) => {
      invalidateThreadDetail(queryClient, id);
      invalidateThreadLists(queryClient);
    },
  });
}

/** Archive a thread together with its live children (`POST /threads/:id/archive-all`). */
export function useArchiveThread() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadArchiveAllResponse,
    Error,
    ThreadIdRequest,
    ArchiveThreadsTransaction
  >({
    meta: { errorMessage: "Failed to archive thread." },
    mutationFn: ({ id }) => sdk.threads.archiveAll({ threadId: id }),
    onMutate: ({ id }) =>
      beginArchiveThreadAndChildrenTransaction({ queryClient, threadId: id }),
    onError: (_error, _variables, transaction) =>
      rollbackArchiveThreadsTransaction(queryClient, transaction),
    onSettled: (data, _error, _variables, transaction) =>
      settleArchiveThreadsTransaction(
        queryClient,
        data?.archivedThreadIds ?? transaction?.archivedThreadIds ?? [],
      ),
  });
}

export function useUnarchiveThread() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    ThreadIdRequest,
    ThreadListMutationTransaction
  >({
    meta: { errorMessage: "Failed to unarchive thread." },
    mutationFn: async ({ id }) => {
      await sdk.threads.unarchive({ threadId: id });
    },
    onMutate: ({ id }) =>
      beginUnarchiveThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, { id }, transaction) =>
      rollbackThreadListMutation({ queryClient, threadId: id }, transaction),
    onSettled: (_data, _error, { id }) => {
      invalidateThreadDetail(queryClient, id);
      invalidateThreadLists(queryClient);
    },
  });
}

export function useDeleteThread() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    DeleteThreadRequest,
    ThreadListMutationTransaction
  >({
    meta: { errorMessage: "Failed to delete thread." },
    mutationFn: async ({ id, childThreadsConfirmed }) => {
      await sdk.threads.delete({ threadId: id, childThreadsConfirmed });
    },
    onMutate: ({ id }) =>
      beginDeleteThreadTransaction({ queryClient, threadId: id }),
    onError: (_error, { id }, transaction) =>
      rollbackThreadListMutation({ queryClient, threadId: id }, transaction),
    onSettled: (_data, _error, { id }) =>
      settleDeleteThreadTransaction(queryClient, id),
  });
}

/**
 * How many live children a thread has (`GET /threads/:id/child-summary`).
 * The delete confirmation asks before setting `childThreadsConfirmed`.
 */
export function useThreadChildSummary() {
  const { sdk } = useProfileClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: (threadId: string) => sdk.threads.childSummary({ threadId }),
  });
}

export function useMarkThreadRead() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadResponse,
    Error,
    string,
    ThreadListMutationTransaction
  >({
    meta: {
      errorMessage: "Failed to mark thread read.",
      showErrorToast: false,
    },
    mutationFn: (threadId) => sdk.threads.markRead({ threadId }),
    onMutate: (threadId) =>
      beginThreadReadStateTransaction({
        queryClient,
        threadId,
        lastReadAt: Date.now(),
      }),
    onError: (_error, threadId, transaction) =>
      rollbackThreadListMutation({ queryClient, threadId }, transaction),
    onSuccess: (thread) => applyThreadResult(queryClient, thread),
  });
}

export function useMarkThreadUnread() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadResponse,
    Error,
    string,
    ThreadListMutationTransaction
  >({
    meta: {
      errorMessage: "Failed to mark thread unread.",
      showErrorToast: false,
    },
    mutationFn: (threadId) => sdk.threads.markUnread({ threadId }),
    onMutate: (threadId) =>
      beginThreadReadStateTransaction({
        queryClient,
        threadId,
        lastReadAt: null,
      }),
    onError: (_error, threadId, transaction) =>
      rollbackThreadListMutation({ queryClient, threadId }, transaction),
    onSuccess: (thread) => applyThreadResult(queryClient, thread),
  });
}
