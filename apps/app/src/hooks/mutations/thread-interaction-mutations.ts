import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PendingInteraction } from "@bb/domain";
import type { ResolvePendingInteractionRequest } from "@bb/server-contract";
import { BbHttpError, sdk } from "@/lib/sdk";
import { isHostDisconnectedError } from "@/lib/lifecycle-errors";
import { wsManager } from "@/lib/ws";
import { useEnvironment } from "../queries/environment-queries";
import { useHosts } from "../queries/host-queries";
import { useThread } from "../queries/thread-queries";
import { invalidateThreadPendingInteractionResolutionQueries } from "../cache-owners/mutation-cache-effects";
import {
  applyResolvedThreadPendingInteraction,
  beginResolveThreadPendingInteractionTransaction,
  invalidateThreadPendingInteractionQueries,
  rollbackResolveThreadPendingInteractionTransaction,
} from "../cache-owners/thread-interaction-cache-owner";

interface ResolveThreadPendingInteractionMutationRequest {
  threadId: string;
  interactionId: string;
  resolution: ResolvePendingInteractionRequest;
}

const CONFLICT_STATUS = 409;

function useIsThreadHostConnected(threadId: string): boolean {
  const environmentId = useThread(threadId).data?.environmentId;
  const hostId = useEnvironment(environmentId).data?.hostId;
  const hosts = useHosts({ enabled: hostId !== undefined }).data;
  return (
    hosts?.some((host) => host.id === hostId && host.status === "connected") ??
    false
  );
}

export function useResolveThreadPendingInteraction(threadId: string) {
  const queryClient = useQueryClient();
  const isHostConnected = useIsThreadHostConnected(threadId);

  const mutation = useMutation({
    meta: {
      errorMessage: "Failed to resolve pending interaction.",
      showErrorToast: false,
    },
    mutationFn: ({
      threadId,
      interactionId,
      resolution,
    }: ResolveThreadPendingInteractionMutationRequest): Promise<PendingInteraction> =>
      sdk.threads.interactions.resolve({
        interactionId,
        resolution,
        threadId,
      }),
    onMutate: (variables) =>
      beginResolveThreadPendingInteractionTransaction({
        interactionId: variables.interactionId,
        queryClient,
        resolution: variables.resolution,
        threadId: variables.threadId,
      }),
    onError: (error, variables, transaction) => {
      rollbackResolveThreadPendingInteractionTransaction({
        queryClient,
        threadId: variables.threadId,
        transaction,
      });
      if (error instanceof BbHttpError && error.status === CONFLICT_STATUS) {
        invalidateThreadPendingInteractionQueries({
          queryClient,
          threadId: variables.threadId,
        });
      }
    },
    onSuccess: (interaction, variables) => {
      applyResolvedThreadPendingInteraction({
        interaction,
        queryClient,
        threadId: variables.threadId,
      });
      if (wsManager.getConnectionState() === "connected") {
        invalidateThreadPendingInteractionQueries({
          queryClient,
          threadId: variables.threadId,
        });
      } else {
        invalidateThreadPendingInteractionResolutionQueries({
          queryClient,
          threadId: variables.threadId,
        });
      }
      return interaction;
    },
  });

  const isStaleHostError =
    isHostConnected && isHostDisconnectedError(mutation.error);
  return { ...mutation, error: isStaleHostError ? null : mutation.error };
}
