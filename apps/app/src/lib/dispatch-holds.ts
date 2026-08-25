import type { PromptInput } from "@bb/domain";
import {
  DISPATCH_HOLD_CORE_HOLDER_PREFIX,
  DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX,
  DISPATCH_HOLD_USER_HOLDER,
} from "@bb/domain";
import type { PromptDraftState } from "@bb/client-core";
import { queuedInputToDraft } from "@bb/client-core";
import type { DispatchHoldResponse } from "@bb/server-contract";

/**
 * When a hold is expected to dispatch. `resumeAt` is a promise core's timer
 * sweep keeps, `expectedReleaseAt` is the owner's estimate, and `createdAt` is
 * the fallback for a hold that has neither — one waiting on a limiter releases
 * as soon as a slot frees, so oldest-first is the right order for those.
 */
export function dispatchHoldExpectedDispatchAt(
  hold: DispatchHoldResponse,
): number {
  return hold.resumeAt ?? hold.expectedReleaseAt ?? hold.createdAt;
}

/**
 * Staleness is a clock comparison, so it is computed here rather than served:
 * a cached response would go stale about staleness. A hold that never declared
 * `staleAfterMs` is never stale — silence is the expected state for a
 * scheduled send.
 */
export function isDispatchHoldStale(
  hold: DispatchHoldResponse,
  now: number,
): boolean {
  if (hold.staleAfterMs === null) {
    return false;
  }
  return now - (hold.lastReportAt ?? hold.createdAt) > hold.staleAfterMs;
}

/**
 * The pending region's order: soonest expected dispatch first, oldest first
 * within a tie, then by id so the list never reshuffles between renders for
 * holds created in the same millisecond.
 */
export function orderDispatchHoldsByExpectedDispatch(
  holds: readonly DispatchHoldResponse[],
): DispatchHoldResponse[] {
  return [...holds].sort((left, right) => {
    const byDispatch =
      dispatchHoldExpectedDispatchAt(left) -
      dispatchHoldExpectedDispatchAt(right);
    if (byDispatch !== 0) return byDispatch;
    const byCreated = left.createdAt - right.createdAt;
    if (byCreated !== 0) return byCreated;
    return left.id.localeCompare(right.id);
  });
}

/** Only a live hold belongs in the pending region; released holds are history. */
export function isLiveDispatchHold(hold: DispatchHoldResponse): boolean {
  return hold.releasedAt === null;
}

/**
 * The draft a cancelled hold hands back to the composer. A retry hold
 * references a turn that already ran, so there is nothing to restore.
 */
export function dispatchHoldInlineInput(
  hold: DispatchHoldResponse,
): PromptInput[] | null {
  return hold.payload.kind === "inline" ? hold.payload.input : null;
}

export function isDispatchHoldEditable(hold: DispatchHoldResponse): boolean {
  return hold.payload.kind === "inline" && hold.payload.editable;
}

export interface DispatchHoldCancelOutcomeArgs {
  hold: DispatchHoldResponse;
  /** Live holds on the thread *before* this cancellation lands. */
  liveHoldCount: number;
  /** True when the thread's runtime display status is `held`. */
  isNeverStartedThread: boolean;
}

export interface DispatchHoldCancelOutcome {
  /** The composer draft to restore, or null when there is nothing to restore. */
  draft: PromptDraftState | null;
  /** Whether to offer deleting the now-empty thread shell. */
  offerDeleteThread: boolean;
}

/**
 * Cancelling is always safe, which is why it needs no confirmation: an inline
 * hold's input goes straight back to the composer as a draft. Cancelling the
 * only hold on a never-started thread leaves an empty shell, so that — and
 * only that — case offers to delete the thread.
 */
export function resolveDispatchHoldCancelOutcome({
  hold,
  liveHoldCount,
  isNeverStartedThread,
}: DispatchHoldCancelOutcomeArgs): DispatchHoldCancelOutcome {
  const input = dispatchHoldInlineInput(hold);
  return {
    draft: input === null ? null : queuedInputToDraft(input),
    offerDeleteThread: isNeverStartedThread && liveHoldCount <= 1,
  };
}

/**
 * The input a saved inline edit sends. The card edits plain text, so mentions
 * are dropped (their offsets no longer describe the rewritten text) while
 * attachments and agent-only blocks are preserved untouched.
 */
export function buildEditedDispatchHoldInput(
  input: readonly PromptInput[],
  text: string,
): PromptInput[] {
  const preserved = input.filter(
    (chunk) => chunk.type !== "text" || chunk.visibility === "agent-only",
  );
  return [{ type: "text", text, mentions: [] }, ...preserved];
}

/**
 * Who to name in the card's aria label. The holder string is prefixed rather
 * than enumerated, so the plugin id is read off the prefix.
 */
export function describeDispatchHoldHolder(
  hold: DispatchHoldResponse,
): string {
  if (hold.holder === DISPATCH_HOLD_USER_HOLDER) {
    return "you";
  }
  if (hold.holder.startsWith(DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX)) {
    return hold.holder.slice(DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX.length);
  }
  return hold.holder.slice(DISPATCH_HOLD_CORE_HOLDER_PREFIX.length);
}
