import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ThreadRewindBranchHistoryResponse,
  ThreadRewindCommitResponse,
  ThreadRewindPreviewResponse,
} from "@bb/server-contract";
import type { ThreadRewindIneligibilityReason } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { isThreadRewindPreviewEligible } from "@/lib/thread-rewind";
import {
  invalidateThreadRewindCaches,
  threadRewindBranchesQueryKey,
  threadRewindPreviewQueryKey,
} from "../cache-owners/thread-rewind-cache-owner";

export interface ThreadRewindPreviewQueryArgs {
  branchId: string;
  sourceSequence: number;
  threadId: string;
  turnId: string;
}

/**
 * Active branch pointer for a thread. Rewind targets are scoped to the active
 * branch, so the UI waits for this before offering the edit action.
 */
export function useThreadRewindBranches(threadId: string): {
  activeBranchId: string | null;
  isLoading: boolean;
} {
  const query = useQuery<ThreadRewindBranchHistoryResponse | null>({
    queryKey: threadRewindBranchesQueryKey(threadId),
    queryFn: async () =>
      threadId === "" ? null : sdk.threads.rewind.branches({ threadId }),
    enabled: threadId !== "",
  });
  return {
    activeBranchId: query.data?.activeBranchId ?? null,
    isLoading: query.isLoading,
  };
}

export interface ThreadRewindMessageEligibilityArgs
  extends ThreadRewindPreviewQueryArgs {
  enabled: boolean;
  /** Changes when the thread leaves or returns to idle; part of the cache key. */
  statusKey: string;
}

export interface ThreadRewindMessageEligibilityResult {
  ineligibilityReason: ThreadRewindIneligibilityReason | null;
  isEligible: boolean;
  isLoading: boolean;
}

/**
 * Server-authoritative eligibility for one user timeline row. The pencil
 * action only renders once the preview resolves as eligible, so ineligible
 * messages never show a dead affordance.
 */
export function useThreadRewindMessageEligibility({
  branchId,
  enabled,
  sourceSequence,
  statusKey,
  threadId,
  turnId,
}: ThreadRewindMessageEligibilityArgs): ThreadRewindMessageEligibilityResult {
  const query = useQuery<ThreadRewindPreviewResponse>({
    queryKey: threadRewindPreviewQueryKey(
      { branchId, sourceSequence, threadId, turnId },
      statusKey,
    ),
    queryFn: () =>
      sdk.threads.rewind.preview({
        branchId,
        sourceSequence,
        threadId,
        turnId,
      }),
    enabled,
    staleTime: 0,
  });
  const preview = query.data;
  return {
    ineligibilityReason:
      preview !== undefined && preview.eligibility.status === "ineligible"
        ? preview.eligibility.reason
        : null,
    isEligible: preview !== undefined && isThreadRewindPreviewEligible(preview),
    isLoading: query.isLoading,
  };
}

export interface ThreadRewindCommitMutationResult {
  commit: (args: {
    editedInput: Parameters<typeof sdk.threads.rewind.commit>[0]["editedInput"];
    idempotencyKey: string;
    preview: Pick<ThreadRewindPreviewResponse, "revision" | "target">;
    threadId: string;
  }) => Promise<ThreadRewindCommitResponse>;
  isPending: boolean;
}

/** Commit a rewind edit. Invalidates rewind caches on success so the pencil
 * set and branch pointer follow the new active branch. */
export function useThreadRewindCommit(): ThreadRewindCommitMutationResult {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (args: {
      editedInput: Parameters<typeof sdk.threads.rewind.commit>[0]["editedInput"];
      idempotencyKey: string;
      preview: Pick<ThreadRewindPreviewResponse, "revision" | "target">;
      threadId: string;
    }) =>
      sdk.threads.rewind.commit({
        editedInput: args.editedInput,
        idempotencyKey: args.idempotencyKey,
        mode: "conversation-only",
        preview: args.preview,
        target: args.preview.target,
        threadId: args.threadId,
      }),
    onSuccess: (_response, args) => {
      invalidateThreadRewindCaches(queryClient, args.threadId);
    },
  });
  return {
    commit: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
