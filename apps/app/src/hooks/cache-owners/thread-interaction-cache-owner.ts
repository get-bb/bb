import type { QueryClient } from "@tanstack/react-query";
import {
  isApprovalPendingInteraction,
  isPluginExtensionPendingInteraction,
  isPluginPendingInteraction,
  isUserQuestionPendingInteraction,
  type PendingInteraction,
} from "@bb/domain";
import type {
  ResolvePendingInteractionRequest,
  ThreadPendingInteractionsResponse,
} from "@bb/server-contract";
import { threadPendingInteractionsQueryKey } from "../queries/query-keys";
import { getThreadPendingInteractionInvalidationQueryKeys } from "./cache-invalidation-groups";

interface ThreadInteractionCacheArgs {
  queryClient: QueryClient;
  threadId: string;
}

interface BeginResolveThreadPendingInteractionTransactionArgs
  extends ThreadInteractionCacheArgs {
  interactionId: string;
  resolution: ResolvePendingInteractionRequest;
}

export interface ResolveThreadPendingInteractionTransaction {
  interactionId: string;
  previousInteraction: PendingInteraction;
}

interface RollbackResolveThreadPendingInteractionTransactionArgs
  extends ThreadInteractionCacheArgs {
  transaction: ResolveThreadPendingInteractionTransaction | undefined;
}

interface ApplyResolvedThreadPendingInteractionArgs
  extends ThreadInteractionCacheArgs {
  interaction: PendingInteraction;
}

function withOptimisticResolution(
  interaction: PendingInteraction,
  resolution: ResolvePendingInteractionRequest,
): PendingInteraction {
  if ("decision" in resolution) {
    return isApprovalPendingInteraction(interaction)
      ? { ...interaction, status: "resolving", resolution }
      : { ...interaction, status: "resolving" };
  }
  if (
    resolution.kind === "user_answer" &&
    isUserQuestionPendingInteraction(interaction)
  ) {
    return { ...interaction, status: "resolving", resolution };
  }
  if (
    resolution.kind === "plugin_submitted" &&
    isPluginPendingInteraction(interaction)
  ) {
    return { ...interaction, status: "resolving", resolution };
  }
  if (
    resolution.kind === "request_answer" &&
    isPluginExtensionPendingInteraction(interaction)
  ) {
    return { ...interaction, status: "resolving", resolution };
  }
  return { ...interaction, status: "resolving" };
}

function isListedInteractionStatus(
  status: PendingInteraction["status"],
): boolean {
  return status === "pending" || status === "resolving";
}

export async function beginResolveThreadPendingInteractionTransaction({
  interactionId,
  queryClient,
  resolution,
  threadId,
}: BeginResolveThreadPendingInteractionTransactionArgs): Promise<
  ResolveThreadPendingInteractionTransaction | undefined
> {
  const queryKey = threadPendingInteractionsQueryKey(threadId);
  await queryClient.cancelQueries({ queryKey });
  const previousInteraction = queryClient
    .getQueryData<ThreadPendingInteractionsResponse>(queryKey)
    ?.find((interaction) => interaction.id === interactionId);
  if (previousInteraction === undefined) {
    return undefined;
  }
  queryClient.setQueryData<ThreadPendingInteractionsResponse>(
    queryKey,
    (interactions) =>
      interactions?.map((interaction) =>
        interaction.id === interactionId
          ? withOptimisticResolution(interaction, resolution)
          : interaction,
      ),
  );
  return { interactionId, previousInteraction };
}

export function rollbackResolveThreadPendingInteractionTransaction({
  queryClient,
  threadId,
  transaction,
}: RollbackResolveThreadPendingInteractionTransactionArgs): void {
  if (transaction === undefined) {
    return;
  }
  queryClient.setQueryData<ThreadPendingInteractionsResponse>(
    threadPendingInteractionsQueryKey(threadId),
    (interactions) =>
      interactions?.map((interaction) =>
        interaction.id === transaction.interactionId &&
        interaction.status === "resolving"
          ? transaction.previousInteraction
          : interaction,
      ),
  );
}

export function applyResolvedThreadPendingInteraction({
  interaction,
  queryClient,
  threadId,
}: ApplyResolvedThreadPendingInteractionArgs): void {
  queryClient.setQueryData<ThreadPendingInteractionsResponse>(
    threadPendingInteractionsQueryKey(threadId),
    (interactions) => {
      if (interactions === undefined) {
        return interactions;
      }
      if (!isListedInteractionStatus(interaction.status)) {
        return interactions.filter(
          (candidate) => candidate.id !== interaction.id,
        );
      }
      return interactions.map((candidate) =>
        candidate.id === interaction.id ? interaction : candidate,
      );
    },
  );
}

export function invalidateThreadPendingInteractionQueries({
  queryClient,
  threadId,
}: ThreadInteractionCacheArgs): void {
  for (const queryKey of getThreadPendingInteractionInvalidationQueryKeys({
    threadId,
  })) {
    void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
  }
}
