import { useMemo } from "react";
import {
  mutationOptions,
  onlineManager,
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
import { BbHttpError } from "@bb/sdk/browser";
import { isAbortLikeError } from "@/lib/mutation-errors";
import { sdk } from "@/lib/sdk";
import type { LifecycleErrorOperation } from "@/lib/lifecycle-errors";
import {
  abandonThreadReadStateTransaction,
  applyThreadUpdateResult,
  beginArchiveThreadAndChildrenTransaction,
  beginDeleteThreadTransaction,
  beginThreadReadStateTransaction,
  beginThreadMetadataTransaction,
  beginUnarchiveThreadTransaction,
  hasFailedThreadRead,
  rollbackArchiveThreadsTransaction,
  rollbackDeleteThreadTransaction,
  rollbackThreadListMutationTransaction,
  isLatestThreadReadStateTransaction,
  noteThreadSeenRead,
  settleThreadReadStateFailure,
  settleThreadReadStateSuccess,
  type ThreadReadStateTransaction,
  whenThreadReadStateSuperseded,
  settleArchiveThreadsTransaction,
  settleDeleteThreadTransaction,
  settleThreadListMembershipMutation,
  succeedThreadListMutationTransaction,
  type ArchiveThreadsTransaction,
  type DeleteThreadTransaction,
  type ThreadListMutationTransaction,
  threadReadStateMutationIdentity,
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

const READ_STATE_ATTEMPT_TIMEOUT_MS = 10_000;
const READ_STATE_RETRIES = 4;
const READ_STATE_RETRY_DELAY_MAX_MS = 8_000;

export type ThreadReadStateCommand =
  | {
      kind: "read";
      threadId: string;
      throughAttentionAt?: number;
      signal?: AbortSignal;
    }
  | { kind: "unread"; threadId: string; signal?: AbortSignal };

type ThreadReadStateSdk = Pick<typeof sdk.threads, "markRead" | "markUnread">;

function supersededError(): Error {
  return new DOMException(
    "A newer read state change for this thread replaced this one",
    "AbortError",
  );
}

interface ThreadReadStateCommandState {
  sent: boolean;
  readonly transaction: ThreadReadStateTransaction;
  readonly turn: Promise<void>;
  readonly finish: () => void;
}

const threadReadStateQueues = new WeakMap<
  QueryClient,
  Map<string, Promise<void>>
>();

function takeThreadReadStateTurn(
  queryClient: QueryClient,
  threadId: string,
): Pick<ThreadReadStateCommandState, "finish" | "turn"> {
  const queues =
    threadReadStateQueues.get(queryClient) ?? new Map<string, Promise<void>>();
  threadReadStateQueues.set(queryClient, queues);
  const turn = queues.get(threadId) ?? Promise.resolve();
  let finish = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const tail = turn.then(() => finished);
  queues.set(threadId, tail);
  void tail.then(() => {
    if (queues.get(threadId) === tail) queues.delete(threadId);
  });
  return { finish, turn };
}

interface ThreadReadStateMutateOptions {
  onError?: (error: unknown) => void;
}

interface ThreadReadStateMutation<Input> {
  mutate: (input: Input, options?: ThreadReadStateMutateOptions) => void;
  mutateAsync: (input: Input) => Promise<ThreadResponse>;
}

interface ThreadReadMutation extends ThreadReadStateMutation<{
  threadId: string;
  throughAttentionAt?: number;
}> {
  hasFailed: (threadId: string, latestAttentionAt: number) => boolean;
  noteSeenRead: (threadId: string) => void;
}

function isDefiniteReadStateRejection(error: unknown): boolean {
  return (
    error instanceof BbHttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

async function sendThreadReadStateAttempt(
  threadSdk: ThreadReadStateSdk,
  command: ThreadReadStateCommand,
): Promise<ThreadResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("Read state request timed out", "TimeoutError"),
      ),
    READ_STATE_ATTEMPT_TIMEOUT_MS,
  );
  const callerSignal = command.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    if (command.kind === "unread") {
      return await threadSdk.markUnread({
        threadId: command.threadId,
        signal: controller.signal,
      });
    }
    return await threadSdk.markRead({
      threadId: command.threadId,
      signal: controller.signal,
      ...(command.throughAttentionAt === undefined
        ? {}
        : { experimental_throughAttentionAt: command.throughAttentionAt }),
    });
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function waitForReadStateRetry(
  state: ThreadReadStateCommandState,
  signal: AbortSignal | undefined,
  subscribe: (wake: () => void) => () => void,
): Promise<void> {
  return new Promise((resolve) => {
    const cleanups: (() => void)[] = [];
    const wake = () => {
      for (const cleanup of cleanups) cleanup();
      resolve();
    };
    cleanups.push(subscribe(wake));
    cleanups.push(whenThreadReadStateSuperseded(state.transaction, wake));
    if (signal) {
      signal.addEventListener("abort", wake, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", wake));
    }
  });
}

async function sendThreadReadStateCommand({
  command,
  queryClient,
  state,
  threadSdk,
}: {
  command: ThreadReadStateCommand;
  queryClient: QueryClient;
  state: ThreadReadStateCommandState;
  threadSdk: ThreadReadStateSdk;
}): Promise<ThreadResponse> {
  const { signal } = command;
  const stopReason = (): Error | null => {
    if (signal?.aborted) return abortReason(signal);
    return isLatestThreadReadStateTransaction(queryClient, state.transaction)
      ? null
      : supersededError();
  };
  for (let attempt = 0; ; attempt += 1) {
    const stop = stopReason();
    if (stop) throw stop;
    state.sent = true;
    try {
      return await sendThreadReadStateAttempt(threadSdk, command);
    } catch (error) {
      const stopAfterFailure = stopReason();
      if (stopAfterFailure) throw stopAfterFailure;
      if (
        attempt >= READ_STATE_RETRIES ||
        isDefiniteReadStateRejection(error)
      ) {
        throw error;
      }
      const delay = Math.min(
        1_000 * 2 ** attempt,
        READ_STATE_RETRY_DELAY_MAX_MS,
      );
      await waitForReadStateRetry(state, signal, (wake) => {
        const timer = setTimeout(wake, delay);
        return () => clearTimeout(timer);
      });
      if (!stopReason() && !onlineManager.isOnline()) {
        await waitForReadStateRetry(state, signal, (wake) =>
          onlineManager.subscribe((online) => {
            if (online) wake();
          }),
        );
      }
    }
  }
}

function threadReadStateMutationOptions(
  queryClient: QueryClient,
  command: ThreadReadStateCommand,
  threadSdk: ThreadReadStateSdk,
  state: ThreadReadStateCommandState,
) {
  return mutationOptions<ThreadResponse, Error, ThreadReadStateCommand>({
    ...threadReadStateMutationIdentity(),
    meta: {
      errorMessage:
        command.kind === "read"
          ? "Failed to mark thread read."
          : "Failed to mark thread unread.",
      showErrorToast: false,
    },
    networkMode: "always",
    retry: false,
    mutationFn: async () => {
      await state.turn;
      return sendThreadReadStateCommand({
        command,
        queryClient,
        state,
        threadSdk,
      });
    },
    onSuccess: (thread) => {
      settleThreadReadStateSuccess({
        queryClient,
        thread,
        transaction: state.transaction,
      });
    },
    onError: () => {
      settleThreadReadStateFailure({
        queryClient,
        transaction: state.transaction,
      });
    },
  });
}

export function runThreadReadStateCommand(
  queryClient: QueryClient,
  command: ThreadReadStateCommand,
  threadSdk: ThreadReadStateSdk = sdk.threads,
): Promise<ThreadResponse> {
  const { signal } = command;
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const state: ThreadReadStateCommandState = {
    sent: false,
    transaction: beginThreadReadStateTransaction({
      intent:
        command.kind === "read"
          ? { kind: "read", throughAttentionAt: command.throughAttentionAt }
          : { kind: "unread" },
      queryClient,
      threadId: command.threadId,
    }),
    ...takeThreadReadStateTurn(queryClient, command.threadId),
  };
  const execution = queryClient
    .getMutationCache()
    .build(
      queryClient,
      threadReadStateMutationOptions(queryClient, command, threadSdk, state),
    )
    .execute(command);
  void execution.then(state.finish, state.finish);
  if (!signal) return execution;
  return new Promise((resolve, reject) => {
    const abandon = () => {
      if (!state.sent) {
        abandonThreadReadStateTransaction({
          queryClient,
          transaction: state.transaction,
        });
      }
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", abandon, { once: true });
    void execution
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abandon));
  });
}

function toThreadReadStateMutation<Input>(
  run: (input: Input) => Promise<ThreadResponse>,
): ThreadReadStateMutation<Input> {
  return {
    mutateAsync: run,
    mutate: (input, options) => {
      run(input).catch((error: unknown) => {
        if (!isAbortLikeError(error)) options?.onError?.(error);
      });
    },
  };
}

export function useMarkThreadRead(): ThreadReadMutation {
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      ...toThreadReadStateMutation(
        (input: { threadId: string; throughAttentionAt?: number }) =>
          runThreadReadStateCommand(queryClient, { kind: "read", ...input }),
      ),
      hasFailed: (threadId: string, latestAttentionAt: number) =>
        hasFailedThreadRead(queryClient, threadId, latestAttentionAt),
      noteSeenRead: (threadId: string) =>
        noteThreadSeenRead(queryClient, threadId),
    }),
    [queryClient],
  );
}

export function useMarkThreadUnread(): ThreadReadStateMutation<{
  threadId: string;
}> {
  const queryClient = useQueryClient();
  return useMemo(
    () =>
      toThreadReadStateMutation((input) =>
        runThreadReadStateCommand(queryClient, { kind: "unread", ...input }),
      ),
    [queryClient],
  );
}
