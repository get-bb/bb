import type { QueuedMessageWaitingOn, SystemQueueStateStatus } from "@bb/domain";
import { assertNever } from "./assert-never.js";
import type {
  EventProjectionOperationMessage,
  EventProjectionQueueStateMetadata,
} from "./event-projection-types.js";
import { mergeTranscriptEntries } from "./provisioning-helpers.js";

/**
 * The row's lifecycle status, derived from the queued row's own status. A
 * parked row is pending for as long as it is parked: an idle thread with a
 * parked message is waiting on purpose, not stalled, so the row must not be
 * finalized by the projection's end-of-stream sweep (see
 * `interruptOperationMessage`).
 */
export function queueStateOperationStatus(
  status: SystemQueueStateStatus,
): EventProjectionOperationMessage["status"] {
  switch (status) {
    case "parked":
    case "updated":
      return "pending";
    case "dispatched":
      return "completed";
    case "cancelled":
      return "interrupted";
    default:
      return assertNever(status);
  }
}

/**
 * The row's headline, in the words a reader of the thread would use. "Dispatch"
 * is the internal name for the act of starting a turn; from the outside the
 * only visible fact is that a message is waiting to be sent, and then that it
 * was sent or the send was called off.
 *
 * `parked` and `updated` share a headline deliberately — an update is the same
 * row still waiting, and only its reason has moved on.
 */
export function queueStateTitleForStatus(
  status: SystemQueueStateStatus,
): string {
  switch (status) {
    case "parked":
    case "updated":
      return "Waiting to send";
    case "dispatched":
      return "Sent";
    case "cancelled":
      return "Send cancelled";
    default:
      return assertNever(status);
  }
}

/**
 * What the row is waiting for, as the title line says it.
 *
 * The event carries no `reason` string — by design, so a rewritten row cannot
 * contradict itself — so every core wait's words are derived here and only a
 * `plugin` wait has an authored reason. That reason is used alone rather than
 * prefixed with its plugin: this package has no access to manifest display
 * names, and a raw plugin id in the middle of a sentence reads worse than the
 * reason it wrote. Attribution belongs on the queued card, which can resolve
 * the name.
 *
 * The scheduled instant is deliberately absent: it rides the row's own `sendAt`
 * so the renderer can format it in the reader's locale.
 */
export function describeQueueStateWait(waitingOn: QueuedMessageWaitingOn): string {
  switch (waitingOn.kind) {
    case "time":
      return "Scheduled";
    case "thread-busy":
      return "Waiting for the current turn";
    case "provisioning":
      return "Waiting for workspace";
    case "interaction":
      return "Waiting for reply";
    case "plugin":
      return waitingOn.reason;
    default:
      return assertNever(waitingOn);
  }
}

/** Every event for one parked row carries its id, which is the row's identity. */
export function queueStateKey(message: EventProjectionOperationMessage): string {
  return message.queueState?.queuedMessageId ?? message.id;
}

/**
 * A parked row's events are deltas: the latest one carries the current wait and
 * status, and only the transcript entries it added. Once the row has settled
 * its status is final — a late report cannot re-park a dispatched message.
 */
export function mergeQueueStateMetadata(
  existing: EventProjectionQueueStateMetadata | undefined,
  incoming: EventProjectionQueueStateMetadata | undefined,
): EventProjectionQueueStateMetadata | undefined {
  if (!incoming) {
    return existing ? { ...existing } : undefined;
  }
  if (!existing) {
    return { ...incoming };
  }

  const settled =
    existing.queueStatus === "dispatched" || existing.queueStatus === "cancelled";
  const transcript = mergeTranscriptEntries(
    existing.transcript,
    incoming.transcript,
  );
  // The preview follows the wait: while the row is parked it tracks the message
  // (which the sender can still edit), and once it settles the row keeps what it
  // dispatched. Falling back to `existing` also means a settling event that
  // omits the preview cannot blank a row that already had one.
  const inputPreview = settled
    ? (existing.inputPreview ?? incoming.inputPreview)
    : (incoming.inputPreview ?? existing.inputPreview);
  return {
    queuedMessageId: incoming.queuedMessageId,
    queueStatus: settled ? existing.queueStatus : incoming.queueStatus,
    waitingOn: settled ? existing.waitingOn : incoming.waitingOn,
    sendAt: settled ? existing.sendAt : incoming.sendAt,
    ...(inputPreview ? { inputPreview } : {}),
    ...(transcript ? { transcript } : {}),
  };
}
