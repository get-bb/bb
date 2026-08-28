import { useCallback, useMemo, useState } from "react";
import type { PromptDraftState } from "@bb/client-core";
import type { Thread, ThreadRuntimeDisplayStatus } from "@bb/domain";
import type { DispatchHoldResponse } from "@bb/server-contract";
import {
  HeldDispatchCard,
  type HeldDispatchInlineEditor,
} from "@/components/promptbox/banner/HeldDispatchCard";
import { HeldThreadDeleteOffer } from "@/components/promptbox/banner/HeldThreadDeleteOffer";
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
  /** The open held-message editor, owned by the composer above. */
  inlineEditor: HeldDispatchInlineEditor | null;
  onEdit: (hold: DispatchHoldResponse) => void;
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
 * Every live hold gets the same card, including on a thread whose first turn is
 * the held one. That thread used to get a reduced banner instead — one row for
 * the soonest hold, a "+N more" count for the rest, and no Edit action — which
 * meant a scheduled first message was the one message in the app you could not
 * rewrite. `isNeverStartedThread` survives only for the delete offer, which is
 * genuinely about the thread rather than the hold.
 */
function LiveHeldDispatches({
  holds,
  inlineEditor,
  isNeverStartedThread,
  onEdit,
  onOfferDeleteThread,
  restoreComposerDraft,
  thread,
}: LiveHeldDispatchesProps) {
  const { cancelHold, holdActionPending, processingHold, releaseHold } =
    useDispatchHoldActions({
      holds,
      isNeverStartedThread,
      onOfferDeleteThread,
      restoreComposerDraft,
      threadId: thread.id,
    });
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
          inlineEditor={
            inlineEditor?.holdId === hold.id ? inlineEditor : null
          }
          onRelease={releaseHold}
          onCancel={cancelHold}
          onEdit={onEdit}
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
  inlineEditor,
  onEdit,
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
          inlineEditor={inlineEditor}
          isNeverStartedThread={runtimeDisplayStatus === "held"}
          onEdit={onEdit}
          onOfferDeleteThread={offerDeleteThread}
          restoreComposerDraft={restoreComposerDraft}
          runtimeDisplayStatus={runtimeDisplayStatus}
          thread={thread}
        />
      ) : null}
    </>
  );
}
