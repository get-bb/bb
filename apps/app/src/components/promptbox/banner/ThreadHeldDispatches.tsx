import { useCallback, useMemo, useState } from "react";
import type { PromptDraftState } from "@bb/client-core";
import type { Thread, ThreadRuntimeDisplayStatus } from "@bb/domain";
import type { DispatchHoldResponse } from "@bb/server-contract";
import { HeldDispatchCard } from "@/components/promptbox/banner/HeldDispatchCard";
import {
  HeldThreadDeleteOffer,
  ThreadHeldBanner,
} from "@/components/promptbox/banner/ThreadHeldBanner";
import { useDispatchHoldActions } from "@/components/thread/embedded-chat/useDispatchHoldActions";
import { useThreadDispatchHolds } from "@/hooks/queries/thread-queries";
import {
  isLiveDispatchHold,
  orderDispatchHoldsByExpectedDispatch,
} from "@/lib/dispatch-holds";

export interface ThreadHeldDispatchesProps {
  thread: Thread;
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
  /** Restores a cancelled hold's inline input to the composer. */
  restoreComposerDraft: (draft: PromptDraftState) => void;
}

interface LiveHeldDispatchesProps extends ThreadHeldDispatchesProps {
  holds: readonly DispatchHoldResponse[];
  isNeverStartedThread: boolean;
  onOfferDeleteThread: () => void;
}

/**
 * The cards and actions for a thread that actually has live holds. Split from
 * the outer component so a thread without holds — nearly every thread — mounts
 * no hold mutations at all.
 *
 * A never-started thread gets the banner instead of cards: its single hold *is*
 * the thread's whole story, and rendering both would say the same thing twice
 * directly above the composer. Either way the hold's reported progress lives on
 * its timeline row.
 */
function LiveHeldDispatches({
  holds,
  isNeverStartedThread,
  onOfferDeleteThread,
  restoreComposerDraft,
  thread,
}: LiveHeldDispatchesProps) {
  const { cancelHold, holdActionPending, processingHold, releaseHold, saveHoldInput } =
    useDispatchHoldActions({
      holds,
      isNeverStartedThread,
      onOfferDeleteThread,
      restoreComposerDraft,
      threadId: thread.id,
    });
  const [firstHold] = holds;

  if (isNeverStartedThread && firstHold) {
    return (
      <ThreadHeldBanner
        hold={firstHold}
        additionalHoldCount={holds.length - 1}
        actionDisabled={holdActionPending}
        pendingAction={
          processingHold?.holdId === firstHold.id ? processingHold.action : null
        }
        onRelease={releaseHold}
        onCancel={cancelHold}
      />
    );
  }

  return (
    <>
      {holds.map((hold) => (
        <HeldDispatchCard
          key={hold.id}
          hold={hold}
          actionDisabled={holdActionPending}
          pendingAction={
            processingHold?.holdId === hold.id ? processingHold.action : null
          }
          onRelease={releaseHold}
          onCancel={cancelHold}
          onSaveInput={saveHoldInput}
        />
      ))}
    </>
  );
}

/**
 * The held half of the pending region: held dispatches sit in the same stack as
 * queued messages, ordered by when they are expected to dispatch.
 */
export function ThreadHeldDispatches({
  restoreComposerDraft,
  runtimeDisplayStatus,
  thread,
}: ThreadHeldDispatchesProps) {
  const { data: holdsResponse } = useThreadDispatchHolds(thread.id);
  const holds = useMemo(
    () =>
      orderDispatchHoldsByExpectedDispatch(
        (holdsResponse ?? []).filter(isLiveDispatchHold),
      ),
    [holdsResponse],
  );
  // Held per thread id, not a bare boolean: cancelling the last hold unmounts
  // the cards, and navigating to another thread must not carry the offer along.
  const [deleteOfferThreadId, setDeleteOfferThreadId] = useState<string | null>(
    null,
  );
  const offerDeleteThread = useCallback(() => {
    setDeleteOfferThreadId(thread.id);
  }, [thread.id]);
  const dismissDeleteOffer = useCallback(() => {
    setDeleteOfferThreadId(null);
  }, []);

  return (
    <>
      {deleteOfferThreadId === thread.id ? (
        <HeldThreadDeleteOffer thread={thread} onDismiss={dismissDeleteOffer} />
      ) : null}
      {holds.length > 0 ? (
        <LiveHeldDispatches
          holds={holds}
          isNeverStartedThread={runtimeDisplayStatus === "held"}
          onOfferDeleteThread={offerDeleteThread}
          restoreComposerDraft={restoreComposerDraft}
          runtimeDisplayStatus={runtimeDisplayStatus}
          thread={thread}
        />
      ) : null}
    </>
  );
}
