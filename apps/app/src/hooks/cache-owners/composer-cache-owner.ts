import type { QueryClient } from "@tanstack/react-query";
import type { ThreadComposerBootstrapResponse } from "@bb/server-contract";
import { threadDefaultExecutionOptionsQueryKey } from "../queries/thread-default-execution-options-query";
import {
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueuedMessagesQueryKey,
} from "../queries/query-keys";
import { seedSystemExecutionOptionsCache } from "./system-cache-effects";

interface ThreadComposerBootstrapHydrationArgs {
  bootstrap: ThreadComposerBootstrapResponse;
  environmentId: string | null;
  providerId: string | null;
  queryClient: QueryClient;
  threadId: string;
}

export function hydrateThreadComposerBootstrap({
  bootstrap,
  environmentId,
  providerId,
  queryClient,
  threadId,
}: ThreadComposerBootstrapHydrationArgs): void {
  const queuedMessagesQueryKey = threadQueuedMessagesQueryKey(threadId);
  const queuedMessagesQuery = queryClient
    .getQueryCache()
    .find({ queryKey: queuedMessagesQueryKey });
  const hasActiveQueuedMessagesOwner =
    queuedMessagesQuery?.isActive() ?? false;

  queryClient.setQueryData(
    threadDefaultExecutionOptionsQueryKey(threadId),
    bootstrap.defaultExecutionOptions,
  );
  queryClient.setQueryData(
    queuedMessagesQueryKey,
    (
      currentQueuedMessages:
        | ThreadComposerBootstrapResponse["queuedMessages"]
        | undefined,
    ) =>
      currentQueuedMessages === undefined || !hasActiveQueuedMessagesOwner
        ? bootstrap.queuedMessages
        : currentQueuedMessages,
  );
  queryClient.setQueryData(
    threadPromptHistoryQueryKey(threadId),
    bootstrap.promptHistory,
  );
  queryClient.setQueryData(
    threadPendingInteractionsQueryKey(threadId),
    bootstrap.pendingInteractions,
  );
  // Only seed the SHARED system-execution-options cache when the server
  // actually resolved options. Null means "not resolved" (archived /
  // environment-less threads, whose follow-up composer locks the provider and
  // never needs the list) — writing it into systemExecutionOptionsQueryKey
  // would clobber whatever legitimately owns that key, most visibly the
  // new-thread composer, which reads [_, null, providerId] (the same key an
  // environment-less thread maps to). On null we leave the key alone so that
  // owner keeps / fetches its own real data.
  if (bootstrap.executionOptions !== null) {
    seedSystemExecutionOptionsCache({
      environmentId,
      executionOptions: bootstrap.executionOptions,
      providerId,
      queryClient,
    });
  }
}
