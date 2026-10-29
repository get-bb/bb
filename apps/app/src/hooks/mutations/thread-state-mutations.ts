import { useMemo } from "react";
import {
  mutationOptions,
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTaggedMutation } from "@bb/query-tags";
import type {
  ThreadArchiveAllResponse,
  ThreadResponse,
  UpdateThreadRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import type { LifecycleErrorOperation } from "@/lib/lifecycle-errors";
import {
  applyThreadReadStateResult,
  applyThreadUpdateResult,
  beginArchiveThreadAndChildrenTransaction,
  beginDeleteThreadTransaction,
  beginThreadReadStateTransaction,
  beginThreadMetadataTransaction,
  beginUnarchiveThreadTransaction,
  rollbackArchiveThreadsTransaction,
  rollbackDeleteThreadTransaction,
  rollbackThreadListMutationTransaction,
  rollbackThreadReadStateTransaction,
  type ThreadReadStateTransaction,
  settleArchiveThreadsTransaction,
  settleDeleteThreadTransaction,
  settleThreadListMembershipMutation,
  succeedThreadListMutationTransaction,
  type ArchiveThreadsTransaction,
  type DeleteThreadTransaction,
  type ThreadListMutationTransaction,
} from "../cache-owners/thread-state-cache-owner";
import { coreThreadMutations } from "./thread-mutation-batcher";

interface ThreadMutationRequest {
  id: string;
}

type UpdateThreadMutationRequest = ThreadMutationRequest & UpdateThreadRequest;
interface UpdateThreadMutationOptions {
  errorMessage?: string | undefined;
  lifecycleOperation?: LifecycleErrorOperation | undefined;
  showErrorToast?: boolean;
}

interface DeleteThreadMutationRequest {
  id: string;
  childThreadsConfirmed: boolean;
}

interface ThreadReadMutationInput {
  signal?: AbortSignal;
  threadId: string;
}

export function updateThreadMutationOptions(
  queryClient: QueryClient,
  options?: UpdateThreadMutationOptions,
) {
  return mutationOptions<
    ThreadResponse,
    Error,
    UpdateThreadMutationRequest,
    ThreadListMutationTransaction | undefined
  >({
    meta: {
      errorMessage: options?.errorMessage ?? "Failed to update thread.",
      showErrorToast: options?.showErrorToast ?? true,
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
    onSuccess: (thread, request, context) => {
      applyThreadUpdateResult({
        queryClient,
        thread,
        request,
        transaction: context,
      });
    },
  });
}

export function useUpdateThread(options?: UpdateThreadMutationOptions) {
  const queryClient = useQueryClient();
  return useMutation(updateThreadMutationOptions(queryClient, options));
}

function useThreadPinStateMutation(
  operation: "pin" | "unpin",
  errorMessage: string,
) {
  const queryClient = useQueryClient();
  const { mutate } = useTaggedMutation<ThreadMutationRequest, ThreadResponse>({
    client: queryClient,
    meta: { errorMessage },
    call: async ({ id }) => ({
      result: await coreThreadMutations(queryClient)[operation]({
        threadId: id,
      }),
      invalidated: [],
    }),
  });
  return useMemo(
    () => ({
      mutate: (request: ThreadMutationRequest) => {
        mutate(request).catch(() => {});
      },
      mutateAsync: mutate,
    }),
    [mutate],
  );
}

export function usePinThread() {
  return useThreadPinStateMutation("pin", "Failed to pin thread.");
}

export function useUnpinThread() {
  return useThreadPinStateMutation("unpin", "Failed to unpin thread.");
}

export function useArchiveThreadAndChildren() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to archive thread and its child threads.",
      lifecycleOperation: "archive_thread",
      showErrorToast: false,
    },
    mutationFn: ({
      id,
    }: ThreadMutationRequest): Promise<ThreadArchiveAllResponse> =>
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
    onSuccess: (_data, _variables, context) => {
      succeedThreadListMutationTransaction(context);
    },
    onSettled: (_data, _error, variables) => {
      settleThreadListMembershipMutation({
        queryClient,
        threadId: variables.id,
      });
    },
  });
}

export function useRestoreThreadEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to restore workspace.",
    },
    mutationFn: ({ id }: ThreadMutationRequest): Promise<ThreadResponse> =>
      sdk.threads.restoreEnvironment({ threadId: id }),
    onSuccess: (thread) => {
      settleThreadListMembershipMutation({ queryClient, threadId: thread.id });
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
    onError: (_error, _variables, context) => {
      rollbackDeleteThreadTransaction({
        queryClient,
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

export function markThreadReadMutationOptions(
  queryClient: QueryClient,
  threadSdk = sdk.threads,
) {
  return mutationOptions({
    meta: {
      errorMessage: "Failed to mark thread read.",
      showErrorToast: false,
    },
    mutationFn: (input: ThreadReadMutationInput) => threadSdk.markRead(input),
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
    onSuccess: (thread, _input, context) => {
      applyThreadReadStateResult({ queryClient, thread, transaction: context });
    },
  });
}

export function useMarkThreadRead() {
  const queryClient = useQueryClient();
  return useMutation(markThreadReadMutationOptions(queryClient));
}

export function markThreadUnreadMutationOptions(
  queryClient: QueryClient,
  threadSdk = sdk.threads,
) {
  return mutationOptions({
    meta: {
      errorMessage: "Failed to mark thread unread.",
      showErrorToast: false,
    },
    mutationFn: (input: ThreadReadMutationInput) => threadSdk.markUnread(input),
    onMutate: (input): Promise<ThreadReadStateTransaction> =>
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
    onSuccess: (thread, _input, context) => {
      applyThreadReadStateResult({ queryClient, thread, transaction: context });
    },
  });
}

export function useMarkThreadUnread() {
  const queryClient = useQueryClient();
  return useMutation(markThreadUnreadMutationOptions(queryClient));
}
