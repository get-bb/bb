import { useCallback, useState } from "react";
import type { PromptDraftState } from "@bb/client-core";
import type { DispatchHoldResponse } from "@bb/server-contract";
import type { HeldDispatchAction } from "@/components/promptbox/banner/HeldDispatchCard";
import { appToast } from "@/components/ui/app-toast";
import {
  isDispatchHoldConflictError,
  useCancelDispatchHold,
  useReleaseDispatchHold,
} from "@/hooks/mutations/dispatch-hold-mutations";
import { resolveDispatchHoldCancelOutcome } from "@/lib/dispatch-holds";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

interface UseDispatchHoldActionsArgs {
  threadId: string;
  holds: readonly DispatchHoldResponse[];
  /** True when the thread's runtime display status is `held`. */
  isNeverStartedThread: boolean;
  /** Restores a cancelled hold's inline input to the composer. */
  restoreComposerDraft: (draft: PromptDraftState) => void;
  /**
   * Called after cancelling the last hold of a never-started thread: it is now
   * an empty shell, so the caller offers to delete it. Owned by the caller
   * because this component unmounts with the hold it just cancelled.
   */
  onOfferDeleteThread: () => void;
}

export interface UseDispatchHoldActionsResult {
  processingHold: { action: HeldDispatchAction; holdId: string } | null;
  holdActionPending: boolean;
  releaseHold: (hold: DispatchHoldResponse) => void;
  cancelHold: (hold: DispatchHoldResponse) => void;
}

/**
 * Owns the pending region's hold actions: which one is in flight, what a
 * cancellation hands back to the composer, and the delete-thread offer that
 * follows cancelling a never-started thread's only hold.
 */
export function useDispatchHoldActions({
  threadId,
  holds,
  isNeverStartedThread,
  onOfferDeleteThread,
  restoreComposerDraft,
}: UseDispatchHoldActionsArgs): UseDispatchHoldActionsResult {
  const [processingHold, setProcessingHold] = useState<{
    action: HeldDispatchAction;
    holdId: string;
  } | null>(null);
  const releaseDispatchHold = useReleaseDispatchHold();
  const cancelDispatchHold = useCancelDispatchHold();

  const clearProcessingHold = useCallback((holdId: string) => {
    setProcessingHold((current) =>
      current?.holdId === holdId ? null : current,
    );
  }, []);

  const releaseHold = useCallback(
    (hold: DispatchHoldResponse) => {
      setProcessingHold({ action: "release", holdId: hold.id });
      void releaseDispatchHold
        .mutateAsync({ holdId: hold.id, threadId })
        .catch((error: unknown) => {
          // A hold its timer or owner released first answers 409. The refetch
          // the mutation already schedules is the whole correction — reporting
          // it would blame the user for a race they did not lose anything to.
          if (isDispatchHoldConflictError(error)) return;
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to release the held dispatch",
            }),
          );
        })
        .finally(() => {
          clearProcessingHold(hold.id);
        });
    },
    [clearProcessingHold, releaseDispatchHold, threadId],
  );

  const cancelHold = useCallback(
    (hold: DispatchHoldResponse) => {
      const outcome = resolveDispatchHoldCancelOutcome({
        hold,
        isNeverStartedThread,
        liveHoldCount: holds.length,
      });
      setProcessingHold({ action: "cancel", holdId: hold.id });
      void cancelDispatchHold
        .mutateAsync({ holdId: hold.id, threadId })
        .then(() => {
          if (outcome.draft) {
            restoreComposerDraft(outcome.draft);
          }
          if (outcome.offerDeleteThread) {
            onOfferDeleteThread();
          }
        })
        .catch((error: unknown) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to cancel the held dispatch",
            }),
          );
        })
        .finally(() => {
          clearProcessingHold(hold.id);
        });
    },
    [
      cancelDispatchHold,
      clearProcessingHold,
      holds.length,
      isNeverStartedThread,
      onOfferDeleteThread,
      restoreComposerDraft,
      threadId,
    ],
  );

  return {
    processingHold,
    holdActionPending: processingHold !== null,
    releaseHold,
    cancelHold,
  };
}
