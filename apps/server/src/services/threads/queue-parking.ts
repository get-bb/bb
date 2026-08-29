import {
  clearQueuedThreadMessageWaitingOn,
  createQueuedThreadMessageInTransaction,
  reparkClaimedQueuedThreadMessages,
  type ClaimedQueuedThreadMessageRow,
  type QueuedThreadMessageRow,
} from "@bb/db";
import type {
  PromptInput,
  QueuedMessagePayload,
  QueuedMessageSystemNotice,
  QueuedMessageWaitingOn,
  ResolvedThreadExecutionOptions,
  Thread,
  ThreadQueuedMessage,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  emitPluginQueueCancelled,
  emitPluginQueueDispatched,
  emitPluginQueueParked,
} from "../plugins/plugin-thread-events.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";

type QueueParkingDeps = Pick<AppDeps, "db" | "hub">;

/**
 * A settling row, for the plugin event its transition raises.
 *
 * Parking is narrated by the queue rows above the composer, which read the
 * row's own columns — so a settle has nothing to write down, only somebody to
 * tell.
 */
export interface SettleQueueRowArgs {
  row: QueuedThreadMessageRow;
}

/** The message a parked row will carry, as the parking site supplies it. */
export interface ParkDispatchMessage {
  input: PromptInput[];
  execution: ResolvedThreadExecutionOptions;
  senderThreadId: string | null;
  payload: QueuedMessagePayload;
  /** Non-null only when core is parking one of its own system notices. */
  systemNotice: QueuedMessageSystemNotice | null;
}

export interface ParkDispatchArgs {
  thread: Thread;
  message: ParkDispatchMessage;
  waitingOn: QueuedMessageWaitingOn;
  /**
   * The row's scheduled instant. Passed on every park rather than left alone,
   * because a park is a fresh statement of when this row may run: a `time`
   * wait sets it, a plugin wait with a `retryAt` sets it, and every other wait
   * clears it by passing null.
   */
  sendAt: number | null;
  /**
   * Rows already claimed from the queue that this park is RETURNING rather
   * than creating. Present on every drain re-attempt; absent when an inline
   * send parks for the first time.
   */
  claimed: readonly ClaimedQueuedThreadMessageRow[] | null;
}

/**
 * Parks a dispatch: the single place a queued row comes into existence or has
 * its wait rewritten.
 *
 * Creating and re-parking are one function because they are one concept — "this
 * message is waiting, and here is why" — and because every caller reaches it
 * from the same place in {@link attemptDispatch}. The difference is only
 * whether a row already exists: a drain re-attempt hands back the rows it
 * claimed, an inline attempt has none yet.
 *
 * Returns the row the wait now sits on, or null when a re-park lost its row
 * (deleted under the drain), which the caller treats as "nothing to do".
 */
export function parkDispatch(
  deps: QueueParkingDeps,
  args: ParkDispatchArgs,
): ThreadQueuedMessage | null {
  const claimed = args.claimed ?? [];
  const leadClaim = claimed[0];
  let row: QueuedThreadMessageRow | null;

  if (leadClaim === undefined) {
    row = deps.db.transaction(
      (tx) =>
        createQueuedThreadMessageInTransaction(tx, {
          threadId: args.thread.id,
          content: args.message.input,
          senderThreadId: args.message.senderThreadId,
          model: args.message.execution.model,
          reasoningLevel: args.message.execution.reasoningLevel,
          permissionMode: args.message.execution.permissionMode,
          serviceTier: args.message.execution.serviceTier,
          waitingOn: args.waitingOn,
          sendAt: args.sendAt,
          payload: args.message.payload,
          systemNotice: args.message.systemNotice,
        }),
      { behavior: "immediate" },
    );
  } else {
    // Hand every claimed row back AND park the lead in one transaction. Doing
    // it in two would leave the group unclaimed and unparked in between, which
    // is exactly the window where the idle drain could pick up a message a
    // gate has just said must wait.
    row = reparkClaimedQueuedThreadMessages(deps.db, deps.hub, {
      claims: claimed.map((claim) => ({
        id: claim.id,
        claimToken: claim.claimToken,
      })),
      threadId: args.thread.id,
      waitingOn: args.waitingOn,
      sendAt: args.sendAt,
    });
  }

  if (row === null) {
    // The claim no longer holds: the row was deleted under the drain, or a
    // stale-claim sweep reclaimed it. Either way there is nothing left to park.
    return null;
  }
  const entry = toThreadQueuedMessage(row);
  emitPluginQueueParked(entry);
  deps.hub.notifyThread(args.thread.id, ["queue-changed"]);
  return entry;
}

/**
 * Records that a parked row's waits all cleared and it dispatched. Called
 * AFTER the row is consumed, so a plugin listening on `queue.dispatched` sees
 * the row leave the queue rather than a row that is about to.
 */
export function settleQueueRowDispatched(args: SettleQueueRowArgs): void {
  emitPluginQueueDispatched(toThreadQueuedMessage(args.row));
}

/** Records that a parked row was discarded instead of dispatched. */
export function settleQueueRowCancelled(args: SettleQueueRowArgs): void {
  emitPluginQueueCancelled(toThreadQueuedMessage(args.row));
}

/**
 * Drops a row's wait so the next drain re-attempts it. The row stays exactly
 * where it is in the queue; only its eligibility changes.
 */
export function clearQueuedMessageWait(
  deps: QueueParkingDeps,
  args: { queuedMessageId: string; threadId: string },
): QueuedThreadMessageRow | null {
  return clearQueuedThreadMessageWaitingOn(deps.db, deps.hub, {
    id: args.queuedMessageId,
    threadId: args.threadId,
  });
}
