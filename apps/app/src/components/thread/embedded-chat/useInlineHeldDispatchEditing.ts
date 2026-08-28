import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedThreadExecutionOptions } from "@bb/domain";
import type { DispatchHoldResponse } from "@bb/server-contract";
import type { PromptDraftState } from "@bb/client-core";
import { queuedInputToDraft } from "@bb/client-core";
import { isDispatchHoldEditable } from "@/lib/dispatch-holds";
import type { InlineComposerDraftSession } from "./useActiveComposerDraft";

export interface InlineHeldDispatchEditState {
  draft: PromptDraftState;
  editSessionId: number;
  /**
   * The tuple frozen when the hold was created. The inline composer shows it
   * read-only for the same reason the queued-message editor does: the message
   * will run with what it was scheduled with, not with what the bottom
   * composer happens to be set to now.
   */
  execution: ResolvedThreadExecutionOptions;
  holdId: string;
  ownerThreadId: string;
}

interface UseInlineHeldDispatchEditingArgs {
  /** The thread whose held dispatches may be edited inline. */
  ownerThreadId: string;
  holds: readonly DispatchHoldResponse[];
  /** Called when an edit session starts (e.g. clear attachment errors, focus). */
  onBeginEdit?: () => void;
}

interface UseInlineHeldDispatchEditingResult {
  /**
   * The live edit session, already filtered against the current owner thread
   * and the live holds — null the moment the edited hold sends or is cancelled.
   */
  inlineEditingHeldDispatch: InlineHeldDispatchEditState | null;
  /**
   * Ref kept authoritative synchronously on every commit, so back-to-back
   * plugin composer reads and writes in one event observe each other. Same
   * contract as the queued-message session's ref.
   */
  inlineEditingHeldDispatchRef: React.RefObject<InlineHeldDispatchEditState | null>;
  commitInlineHeldDispatch: (next: InlineHeldDispatchEditState | null) => void;
  dismissInlineHeldDispatchEditor: () => void;
  beginEditHeldDispatch: (hold: DispatchHoldResponse) => void;
  /** The composer-draft seam this session presents while it is open. */
  heldDispatchDraftSession: InlineComposerDraftSession | null;
}

/**
 * The inline held-dispatch edit session: "Edit" on a held card opens the same
 * composer a queued message gets, bound to a transient draft of the held
 * message. The persisted bottom-composer draft stays independent.
 *
 * This exists as its own hook rather than a branch of
 * {@link useInlineQueuedMessageEditing} because the two sessions can never be
 * open at once but describe different things: a queued message is identified
 * by its position in the queue and guarded by an `updatedAt`, a hold by its id
 * and guarded by the server's 409 on a hold that already released.
 *
 * The session self-dismisses when the hold leaves the live list — its timer
 * fired, the user hit Send now from another client, or it was cancelled — so
 * an editor can never be left writing into something that has already sent.
 */
export function useInlineHeldDispatchEditing({
  ownerThreadId,
  holds,
  onBeginEdit,
}: UseInlineHeldDispatchEditingArgs): UseInlineHeldDispatchEditingResult {
  const [inlineEditingHeldDispatchState, setInlineEditingHeldDispatch] =
    useState<InlineHeldDispatchEditState | null>(null);
  const inlineEditingHeldDispatchRef =
    useRef<InlineHeldDispatchEditState | null>(null);
  const inlineEditSessionIdRef = useRef(0);

  const commitInlineHeldDispatch = useCallback(
    (next: InlineHeldDispatchEditState | null) => {
      inlineEditingHeldDispatchRef.current = next;
      setInlineEditingHeldDispatch(next);
    },
    [],
  );
  const dismissInlineHeldDispatchEditor = useCallback(() => {
    commitInlineHeldDispatch(null);
  }, [commitInlineHeldDispatch]);

  const inlineEditingHeldDispatch = useMemo(
    () =>
      inlineEditingHeldDispatchState !== null &&
      inlineEditingHeldDispatchState.ownerThreadId === ownerThreadId &&
      holds.some((hold) => hold.id === inlineEditingHeldDispatchState.holdId)
        ? inlineEditingHeldDispatchState
        : null,
    [holds, inlineEditingHeldDispatchState, ownerThreadId],
  );
  useEffect(() => {
    if (
      inlineEditingHeldDispatchState !== null &&
      inlineEditingHeldDispatch === null
    ) {
      dismissInlineHeldDispatchEditor();
    }
  }, [
    dismissInlineHeldDispatchEditor,
    inlineEditingHeldDispatch,
    inlineEditingHeldDispatchState,
  ]);

  const beginEditHeldDispatch = useCallback(
    (hold: DispatchHoldResponse) => {
      if (hold.payload.kind !== "inline" || !isDispatchHoldEditable(hold)) {
        return;
      }
      commitInlineHeldDispatch({
        draft: queuedInputToDraft(hold.payload.input),
        editSessionId: (inlineEditSessionIdRef.current += 1),
        execution: hold.payload.execution,
        holdId: hold.id,
        ownerThreadId,
      });
      onBeginEdit?.();
    },
    [commitInlineHeldDispatch, onBeginEdit, ownerThreadId],
  );

  const editSessionId = inlineEditingHeldDispatch?.editSessionId ?? null;
  const heldDispatchDraftSession =
    useMemo<InlineComposerDraftSession | null>(() => {
      if (editSessionId === null) {
        return null;
      }
      return {
        editSessionId,
        setDraft: (update) => {
          const current = inlineEditingHeldDispatchRef.current;
          if (current === null) return;
          commitInlineHeldDispatch({
            ...current,
            draft: update(current.draft),
          });
        },
      };
    }, [commitInlineHeldDispatch, editSessionId]);

  return {
    inlineEditingHeldDispatch,
    inlineEditingHeldDispatchRef,
    commitInlineHeldDispatch,
    dismissInlineHeldDispatchEditor,
    beginEditHeldDispatch,
    heldDispatchDraftSession,
  };
}
