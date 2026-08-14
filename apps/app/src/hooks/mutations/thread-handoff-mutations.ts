import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  PermissionMode,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type { ThreadHandoffResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { invalidateThreadListMembershipQueries } from "../cache-owners/mutation-cache-effects";
import { threadHandoffQueryKey } from "../queries/query-keys";

export interface ThreadHandoffMutationRequest {
  archiveSource: boolean;
  continuationText?: string;
  idempotencyKey: string;
  model: string;
  permissionMode: PermissionMode;
  providerId: string;
  reasoningLevel: ReasoningLevel;
  serviceTier?: ServiceTier;
  sourceThreadId: string;
}

export function useThreadHandoff() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to hand off thread.",
    },
    mutationFn: (request: ThreadHandoffMutationRequest) =>
      sdk.threads.handoff({
        ...request,
        origin: "app",
      }),
    onSuccess: (result: ThreadHandoffResponse) => {
      queryClient.setQueryData(
        threadHandoffQueryKey(result.replacementThreadId),
        result,
      );
      invalidateThreadListMembershipQueries({
        queryClient,
        threadId: result.sourceThreadId,
      });
      invalidateThreadListMembershipQueries({
        queryClient,
        threadId: result.replacementThreadId,
      });
    },
  });
}
