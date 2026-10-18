import {
  mutationOptions,
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { Host, PendingInteraction } from "@bb/domain";
import type { ResolvePendingInteractionRequest } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { isHostDisconnectedError } from "@/lib/lifecycle-errors";
import { useEnvironment } from "../queries/environment-queries";
import { useHosts } from "../queries/host-queries";
import { useThread } from "../queries/thread-queries";
import {
  applyResolvedThreadPendingInteraction,
  invalidateThreadPendingInteractionResolutionQueries,
} from "../cache-owners/mutation-cache-effects";

interface ResolveThreadPendingInteractionMutationRequest {
  threadId: string;
  interactionId: string;
  resolution: ResolvePendingInteractionRequest;
}

interface VisibleResolveInteractionErrorArgs {
  error: Error | null;
  hostId: string | undefined;
  hosts: readonly Host[] | undefined;
}

export function visibleResolveInteractionError({
  error,
  hostId,
  hosts,
}: VisibleResolveInteractionErrorArgs): Error | null {
  const isHostConnected =
    hosts?.some((host) => host.id === hostId && host.status === "connected") ??
    false;
  return isHostConnected && isHostDisconnectedError(error) ? null : error;
}

export function resolveThreadPendingInteractionMutationOptions(
  queryClient: QueryClient,
) {
  return mutationOptions({
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
    onSuccess: (interaction, variables) => {
      applyResolvedThreadPendingInteraction({ interaction, queryClient });
      invalidateThreadPendingInteractionResolutionQueries({
        queryClient,
        threadId: variables.threadId,
      });
      return interaction;
    },
  });
}

export function useResolveThreadPendingInteraction(threadId: string) {
  const queryClient = useQueryClient();
  const environmentId = useThread(threadId).data?.environmentId;
  const hostId = useEnvironment(environmentId).data?.hostId;
  const hosts = useHosts({ enabled: hostId !== undefined }).data;
  const mutation = useMutation(
    resolveThreadPendingInteractionMutationOptions(queryClient),
  );

  return {
    ...mutation,
    error: visibleResolveInteractionError({
      error: mutation.error,
      hostId,
      hosts,
    }),
  };
}
