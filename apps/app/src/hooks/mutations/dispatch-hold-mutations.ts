import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PromptInput } from "@bb/domain";
import { BbHttpError, sdk } from "@/lib/sdk";
import { invalidateThreadQueueQueries } from "../cache-owners/mutation-cache-effects";

interface DispatchHoldMutationRequest {
  holdId: string;
  threadId: string;
}

interface UpdateDispatchHoldMutationRequest extends DispatchHoldMutationRequest {
  input?: PromptInput[];
  resumeAt?: number;
}

/**
 * A hold that lost the race — released by its timer or its owner between the
 * render and the click — answers 409. That is not an error the user caused, so
 * the caller refreshes rather than reporting it.
 */
export function isDispatchHoldConflictError(error: unknown): boolean {
  return error instanceof BbHttpError && error.status === 409;
}

/**
 * Holds are low-frequency and the server is the only authority on whether a
 * release won its compare-and-set, so these mutations refetch rather than
 * writing an optimistic row the server might contradict. Holds ride the queue
 * content group, which also refreshes the thread — releasing the last hold of a
 * never-started thread changes its runtime display status.
 */
function useInvalidateThreadDispatchHolds() {
  const queryClient = useQueryClient();
  return (threadId: string) => {
    invalidateThreadQueueQueries({ queryClient, threadId });
  };
}

export function useReleaseDispatchHold() {
  const invalidate = useInvalidateThreadDispatchHolds();

  return useMutation({
    meta: {
      errorMessage: "Failed to release the held dispatch.",
      showErrorToast: false,
    },
    mutationFn: async ({ holdId }: DispatchHoldMutationRequest) => {
      await sdk.threads.holds.release({ holdId });
    },
    onSettled: (_data, _error, variables) => {
      invalidate(variables.threadId);
    },
  });
}

export function useCancelDispatchHold() {
  const invalidate = useInvalidateThreadDispatchHolds();

  return useMutation({
    meta: {
      errorMessage: "Failed to cancel the held dispatch.",
      showErrorToast: false,
    },
    mutationFn: async ({ holdId }: DispatchHoldMutationRequest) => {
      await sdk.threads.holds.cancel({ holdId });
    },
    onSettled: (_data, _error, variables) => {
      invalidate(variables.threadId);
    },
  });
}

export function useUpdateDispatchHold() {
  const invalidate = useInvalidateThreadDispatchHolds();

  return useMutation({
    meta: {
      errorMessage: "Failed to update the held dispatch.",
      showErrorToast: false,
    },
    mutationFn: async ({
      holdId,
      input,
      resumeAt,
    }: UpdateDispatchHoldMutationRequest) => {
      await sdk.threads.holds.update({
        holdId,
        ...(input === undefined ? {} : { input }),
        ...(resumeAt === undefined ? {} : { resumeAt }),
      });
    },
    onSettled: (_data, _error, variables) => {
      invalidate(variables.threadId);
    },
  });
}
