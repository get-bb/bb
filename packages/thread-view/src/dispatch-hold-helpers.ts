import type { SystemDispatchHoldStatus } from "@bb/domain";
import { assertNever } from "./assert-never.js";
import type {
  EventProjectionDispatchHoldMetadata,
  EventProjectionOperationMessage,
} from "./event-projection-types.js";
import { mergeTranscriptEntries } from "./provisioning-helpers.js";

/**
 * The row's lifecycle status, derived from the hold's own status. A hold is
 * pending for as long as it is live: an idle thread with a live hold is
 * waiting on purpose, not stalled, so the row must not be finalized by the
 * projection's end-of-stream sweep (see `interruptOperationMessage`).
 */
export function dispatchHoldOperationStatus(
  status: SystemDispatchHoldStatus,
): EventProjectionOperationMessage["status"] {
  switch (status) {
    case "active":
      return "pending";
    case "released":
    case "orphaned":
      return "completed";
    case "cancelled":
      return "interrupted";
    default:
      return assertNever(status);
  }
}

export function dispatchHoldTitleForStatus(
  status: SystemDispatchHoldStatus,
): string {
  switch (status) {
    case "active":
      return "Dispatch held";
    case "released":
      return "Dispatch released";
    case "cancelled":
      return "Dispatch cancelled";
    case "orphaned":
      return "Dispatch released (owner unavailable)";
    default:
      return assertNever(status);
  }
}

/** Every event for one hold carries its id, which is the row's identity. */
export function dispatchHoldKey(
  message: EventProjectionOperationMessage,
): string {
  return message.dispatchHold?.holdId ?? message.id;
}

/**
 * A hold's events are deltas: the latest one carries the current reason and
 * status, and only the transcript entries it added. Once the hold has settled
 * its status is final — a late report cannot reopen a released hold.
 */
export function mergeDispatchHoldMetadata(
  existing: EventProjectionDispatchHoldMetadata | undefined,
  incoming: EventProjectionDispatchHoldMetadata | undefined,
): EventProjectionDispatchHoldMetadata | undefined {
  if (!incoming) {
    return existing ? { ...existing } : undefined;
  }
  if (!existing) {
    return { ...incoming };
  }

  const settled = existing.holdStatus !== "active";
  const transcript = mergeTranscriptEntries(
    existing.transcript,
    incoming.transcript,
  );
  // The preview follows the reason: while the hold is live it tracks the
  // message (which the user can still edit), and once it settles the row keeps
  // what it dispatched. Falling back to `existing` also means a settling event
  // that omits the preview cannot blank a row that already had one.
  const inputPreview = settled
    ? (existing.inputPreview ?? incoming.inputPreview)
    : (incoming.inputPreview ?? existing.inputPreview);
  return {
    holdId: incoming.holdId,
    holder: incoming.holder,
    holdStatus: settled ? existing.holdStatus : incoming.holdStatus,
    reason: settled ? existing.reason : incoming.reason,
    ...(inputPreview ? { inputPreview } : {}),
    ...(transcript ? { transcript } : {}),
  };
}
