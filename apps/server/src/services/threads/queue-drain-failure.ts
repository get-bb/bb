import {
  setQueuedThreadMessageFailureReason,
  setQueuedThreadMessageWaitingOn,
  type QueuedThreadMessageRow,
} from "@bb/db";
import {
  QUEUED_MESSAGE_FAILURE_REASON_MAX_LENGTH,
  type Thread,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { dispatchGateEnvironmentAndHost } from "./dispatch-gates.js";
import { noteQueueStateUpdated, queuedMessageWaitingOn } from "./queue-parking.js";

type QueueDrainFailureDeps = Pick<AppDeps, "db" | "hub">;

/**
 * What a failed dispatch says to the person whose message did not go.
 *
 * `ApiError` messages are already written for a caller, so they pass through.
 * Anything else is an internal fault whose message was written for a log, so
 * the row gets a sentence that is true without pretending to diagnose.
 */
export function describeDispatchFailure(error: unknown): string {
  const message =
    error instanceof ApiError
      ? error.body.message
      : "The message could not be sent.";
  return message.length <= QUEUED_MESSAGE_FAILURE_REASON_MAX_LENGTH
    ? message
    : `${message.slice(0, QUEUED_MESSAGE_FAILURE_REASON_MAX_LENGTH - 1)}…`;
}

/**
 * Settles a DRAIN attempt that neither dispatched nor parked.
 *
 * Two outcomes, and which one applies is decided by asking the world rather
 * than by pattern-matching the error: if the thread's host has no live daemon
 * session *right now*, the attempt did not fail so much as arrive at a machine
 * that is not there, and the row re-parks on a `host-offline` wait that the
 * periodic drain will clear when the machine comes back. Any other failure is
 * recorded as the row's failure reason, leaving its existing wait alone —
 * the row is still parked on whatever it was parked on, and what went wrong
 * last time is a different fact from what it is waiting for.
 *
 * Only the drain calls this. An inline attempt has a caller still listening
 * and surfaces its error to them instead, which is why a queued row never
 * shows a failure the sender was already told about to their face.
 */
export function recordQueuedMessageDrainFailure(
  deps: QueueDrainFailureDeps,
  args: { error: unknown; row: QueuedThreadMessageRow; thread: Thread },
): void {
  const { host } = dispatchGateEnvironmentAndHost(deps, args.thread.environmentId);
  if (host !== null && host.status === "disconnected") {
    const waitingOn = { kind: "host-offline", hostName: host.name } as const;
    const updated = setQueuedThreadMessageWaitingOn(deps.db, deps.hub, {
      id: args.row.id,
      threadId: args.row.threadId,
      waitingOn,
      // An offline host is not a schedule. Whatever instant this row carried
      // has already passed by the time a drain picked it up, and keeping it
      // would leave the due sweep re-claiming a row that cannot dispatch.
      sendAt: null,
    });
    if (updated !== null) {
      noteQueueStateUpdated(deps, { row: updated, waitingOn });
    }
    return;
  }

  const updated = setQueuedThreadMessageFailureReason(deps.db, deps.hub, {
    id: args.row.id,
    threadId: args.row.threadId,
    failureReason: describeDispatchFailure(args.error),
  });
  if (updated !== null) {
    noteQueueStateUpdated(deps, {
      row: updated,
      waitingOn: queuedMessageWaitingOn(updated),
    });
  }
}
