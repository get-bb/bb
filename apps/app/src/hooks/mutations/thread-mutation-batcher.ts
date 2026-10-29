import type { QueryClient } from "@tanstack/react-query";
import type {
  BbSdkAreas,
  ThreadMutationResult,
  ThreadUpdateArgs,
} from "@bb/sdk";
import { sdk } from "@/lib/sdk";
import { registerThreadEntityViews } from "../cache-owners/thread-entity-store";
import { readThreadBack } from "../cache-owners/thread-read-back";
import {
  applyThreadMetadataBatchResult,
  beginThreadMetadataBatchTransaction,
  invalidateThreadMetadataBatch,
  predictThreadPinState,
  rollbackThreadMetadataBatchTransaction,
} from "../cache-owners/thread-state-cache-owner";

type ThreadMutations = Pick<BbSdkAreas["threads"], "update" | "pin" | "unpin">;

type PendingThreadMutation = {
  threadId: string;
  reject: (reason: unknown) => void;
  resolve: (thread: ThreadMutationResult) => void;
} & (
  | { operation: "update"; args: ThreadUpdateArgs }
  | {
      operation: "pin" | "unpin";
      acknowledge: (outcome: Promise<ThreadMutationResult>) => Promise<void>;
    }
);

function hasThreadMetadataUpdate(args: ThreadUpdateArgs): boolean {
  return (
    args.title !== undefined ||
    args.sectionId !== undefined ||
    args.parentThreadId !== undefined
  );
}

export function createThreadMutationBatcher(
  threads: ThreadMutations,
  queryClient: QueryClient,
): ThreadMutations {
  registerThreadEntityViews(queryClient);
  let pending: PendingThreadMutation[] = [];
  let scheduled = false;

  const flush = async () => {
    const batch = pending;
    pending = [];
    scheduled = false;
    const updates = batch.flatMap((request) =>
      request.operation === "update"
        ? [
            {
              threadId: request.threadId,
              title: request.args.title,
              sectionId: request.args.sectionId,
              parentThreadId: request.args.parentThreadId,
            },
          ]
        : [],
    );
    let transaction;
    try {
      transaction =
        updates.length > 0
          ? await beginThreadMetadataBatchTransaction({ queryClient, updates })
          : undefined;
    } catch (error) {
      await Promise.all(
        batch.map((request) =>
          request.operation === "update"
            ? undefined
            : request.acknowledge(Promise.reject(error)),
        ),
      );
      for (const request of batch) request.reject(error);
      return;
    }

    const previousByThread = new Map<string, Promise<ThreadMutationResult>>();
    const results = await Promise.allSettled(
      batch.map((request) => {
        const call = () =>
          request.operation === "update"
            ? threads.update(request.args)
            : threads[request.operation]({ threadId: request.threadId });
        const result = (
          previousByThread.get(request.threadId) ?? Promise.resolve()
        ).then(call);
        previousByThread.set(request.threadId, result);
        return result;
      }),
    );
    const failure = results.find((result) => result.status === "rejected");
    const acknowledged = batch.map((request, index) => {
      if (request.operation === "update") return undefined;
      const result = results[index]!;
      return request.acknowledge(
        failure === undefined && result.status === "fulfilled"
          ? Promise.resolve(result.value)
          : Promise.reject(failure?.reason),
      );
    });
    if (failure === undefined) {
      applyThreadMetadataBatchResult({
        queryClient,
        transaction,
        updates: batch.flatMap((request, index) => {
          const result = results[index];
          return request.operation === "update" &&
            result?.status === "fulfilled"
            ? [{ thread: result.value, request: request.args }]
            : [];
        }),
      });
    } else {
      rollbackThreadMetadataBatchTransaction({ queryClient, transaction });
      invalidateThreadMetadataBatch({
        queryClient,
        threadIds: batch.map(({ threadId }) => threadId),
      });
    }
    await Promise.all(acknowledged);
    results.forEach((result, index) => {
      const request = batch[index];
      if (!request) return;
      if (result.status === "fulfilled") request.resolve(result.value);
      else request.reject(result.reason);
    });
  };

  const enqueue = (request: PendingThreadMutation) => {
    pending.push(request);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => void flush());
  };
  const setPinned =
    (operation: "pin" | "unpin") =>
    ({ threadId }: { threadId: string }) =>
      new Promise<ThreadMutationResult>((resolve, reject) => {
        const prediction = predictThreadPinState(queryClient, {
          pinnedAt: operation === "pin" ? Date.now() : null,
          threadId,
        });
        const acknowledge = async (outcome: Promise<ThreadMutationResult>) => {
          try {
            prediction.confirm([await outcome], readThreadBack(queryClient));
          } catch {
            prediction.fail();
          }
        };
        enqueue({ operation, threadId, acknowledge, resolve, reject });
      });
  return {
    update: (args) =>
      hasThreadMetadataUpdate(args)
        ? new Promise((resolve, reject) =>
            enqueue({
              operation: "update",
              threadId: args.threadId,
              args,
              resolve,
              reject,
            }),
          )
        : threads.update(args),
    pin: setPinned("pin"),
    unpin: setPinned("unpin"),
  };
}

const coreBatchers = new WeakMap<QueryClient, ThreadMutations>();

export function coreThreadMutations(queryClient: QueryClient): ThreadMutations {
  let batcher = coreBatchers.get(queryClient);
  if (batcher === undefined) {
    batcher = createThreadMutationBatcher(sdk.threads, queryClient);
    coreBatchers.set(queryClient, batcher);
  }
  return batcher;
}
