import type {
  PromptInput,
  ThreadRewindFailureReason,
  ThreadRewindIneligibilityReason,
} from "@bb/domain";
import type {
  ThreadRewindBranchHistoryResponse,
  ThreadRewindCommitResponse,
  ThreadRewindPreviewResponse,
} from "@bb/server-contract";
import { promptInputToDraft, type PromptDraftState } from "./prompt-draft";

/**
 * Client-side gate for firing a rewind preview query. The server preview is
 * the source of truth for eligibility, but these cheap row-shape checks keep
 * the UI from issuing a preview request for rows that can never be editable
 * (assistant rows, steers, side-chat rows, missing turn ids).
 */
export interface ThreadRewindCandidateRow {
  role: "user";
  initiator: "user" | "agent" | "system";
  senderThreadId: string | null;
  sourceSeqStart: number;
  turnId: string | null;
  turnRequest:
    | { kind: "message" | "steer"; status: "pending" | "accepted" }
    | null;
}

export function isThreadRewindCandidateRow(
  row: ThreadRewindCandidateRow,
): boolean {
  return (
    row.role === "user" &&
    row.initiator === "user" &&
    row.senderThreadId === null &&
    row.turnRequest?.kind === "message" &&
    row.turnId !== null &&
    row.sourceSeqStart >= 0
  );
}

/**
 * Restore a rewind target's original structured input into a composer draft.
 * Release 1 only exposes the edit action for text-only inputs (the server
 * denies attachments and mentions), but the mapping handles every prompt
 * input kind so a later release that widens eligibility keeps round-tripping
 * without silently dropping content.
 */
export function restoreThreadRewindDraft(
  input: readonly PromptInput[],
): PromptDraftState {
  return promptInputToDraft(input);
}

/**
 * Idempotency key for one rewind edit session. Retrying the same commit with
 * the same key lets the server resume a partially applied rewind instead of
 * creating a second provider branch.
 */
export function buildThreadRewindIdempotencyKey(args: {
  branchId: string;
  randomSuffix?: string;
  sourceSequence: number;
  threadId: string;
  turnId: string;
}): string {
  const suffix =
    args.randomSuffix ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2));
  return [
    "rewind",
    args.threadId,
    args.branchId,
    args.sourceSequence,
    args.turnId,
    suffix,
  ].join(":");
}

/** Stable user-facing explanation for a preview denial. */
export function threadRewindIneligibilityDescription(
  reason: ThreadRewindIneligibilityReason,
): string {
  switch (reason) {
    case "thread-not-idle":
      return "The thread is running. Wait until it's idle to edit an earlier message.";
    case "pending-interaction":
      return "Resolve the pending question or approval first.";
    case "queued-input":
      return "Send or remove queued messages before editing an earlier message.";
    case "first-message":
      return "The first message of a thread can't be rewound yet.";
    case "not-human-root-turn":
      return "Only your own completed messages can be edited.";
    case "turn-incomplete":
      return "That message's turn hasn't finished yet.";
    case "grouped-input":
      return "Grouped inputs can't be edited yet.";
    case "steer":
      return "Steers can't be edited yet.";
    case "attachments-not-supported":
      return "Messages with attachments can't be edited yet.";
    case "mentions-not-supported":
      return "Messages with mentions or commands can't be edited yet.";
    case "compaction-boundary":
      return "The conversation was compacted after that message, so it can't be rewound.";
    case "missing-provider-checkpoint":
      return "There is no exact provider checkpoint for that message.";
    case "ambiguous-provider-checkpoint":
      return "The provider checkpoint for that message is ambiguous.";
    case "unsupported-provider":
      return "The thread's provider doesn't support rewinding.";
    case "archived-thread":
      return "Archived threads can't be rewound.";
    case "fork-thread":
      return "Forked threads can't be rewound.";
    case "side-chat":
      return "Side chats can't be rewound.";
    case "workspace-restore-not-supported":
      return "Workspace restoration isn't supported.";
    case "stale-preview":
      return "The conversation changed since this action opened. Refresh and try again.";
  }
}

/** Stable user-facing failure copy for a rewind commit. */
export function threadRewindFailureMessage(
  code: ThreadRewindFailureReason,
): string {
  switch (code) {
    case "thread-not-found":
      return "The thread is no longer available.";
    case "thread-not-idle":
      return "The thread started running. Your edit is preserved below.";
    case "pending-interaction":
      return "A pending question or approval appeared. Resolve it, then send again.";
    case "queued-input":
      return "Queued messages appeared. Send or remove them, then send again.";
    case "rewind-in-progress":
      return "Another rewind is already applying to this thread. Try again shortly.";
    case "target-ineligible":
      return "That message is no longer editable. Your edit is preserved below.";
    case "provider-branch-failed":
      return "The provider could not create the rewound branch. Your edit is preserved below.";
    case "provider-session-unavailable":
      return "The provider session is unavailable. Your edit is preserved below.";
    case "branch-commit-failed":
      return "The rewound branch could not be activated. Your edit is preserved below.";
    case "workspace-restore-not-supported":
      return "Workspace restoration isn't supported.";
    case "stale-preview":
      return "The conversation changed. Refresh the preview and try again.";
  }
}

/** Pluralized later-turn count for confirmation copy. */
export function displacedTurnCountLabel(count: number): string {
  return count === 1 ? "1 later turn" : `${count} later turns`;
}

export function activeRewindBranchId(
  history: ThreadRewindBranchHistoryResponse | undefined,
): string | null {
  return history?.activeBranchId ?? null;
}

export function isThreadRewindCommitSubmitted(
  response: ThreadRewindCommitResponse,
): boolean {
  return response.submission === "submitted";
}

export function isThreadRewindPreviewEligible(
  preview: ThreadRewindPreviewResponse,
): boolean {
  return preview.eligibility.status === "eligible";
}
