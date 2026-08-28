import {
  clearQueuedThreadMessageWaitingOn,
  createQueuedThreadMessageInTransaction,
  getThread,
  reparkClaimedQueuedThreadMessages,
  type ClaimedQueuedThreadMessageRow,
  type QueuedThreadMessageRow,
} from "@bb/db";
import {
  QUEUE_STATE_INPUT_PREVIEW_MAX_LENGTH,
  threadScope,
  type PromptInput,
  type QueuedMessagePayload,
  type QueuedMessageSystemNotice,
  type QueuedMessageWaitingOn,
  type ResolvedThreadExecutionOptions,
  type SystemQueueStateStatus,
  type Thread,
  type ThreadQueuedMessage,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  emitPluginQueueCancelled,
  emitPluginQueueDispatched,
  emitPluginQueueParked,
} from "../plugins/plugin-thread-events.js";
import { appendThreadEvent } from "./thread-events.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";

type QueueParkingDeps = Pick<AppDeps, "db" | "hub">;

/**
 * Plain text of the message a parked row is sitting on, for its timeline row.
 * The row otherwise says only why the dispatch is waiting, which leaves the
 * reader guessing which of their messages it is.
 *
 * Undefined — never an empty string — when there is nothing of the user's to
 * show: a `retry` row re-submits a turn that is already rendered further up the
 * timeline, and an `inline` row can be attachments or agent-only context with
 * no visible prose. The field is omitted in those cases so a reader that sees
 * it knows it means something.
 */
export function queuedMessageInputPreview(
  row: QueuedThreadMessageRow,
): string | undefined {
  if (row.payloadKind !== "inline") {
    return undefined;
  }
  let blocks: PromptInput[];
  try {
    blocks = toThreadQueuedMessage(row).content;
  } catch {
    return undefined;
  }
  const text = blocks
    .filter(
      (chunk): chunk is Extract<PromptInput, { type: "text" }> =>
        chunk.type === "text" && chunk.visibility !== "agent-only",
    )
    .map((chunk) => chunk.text)
    .join("\n\n")
    // A preview is one run of prose on a row that is already a summary, so
    // paragraph breaks and indentation collapse rather than fighting the
    // row's layout.
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length === 0) {
    return undefined;
  }
  return text.length <= QUEUE_STATE_INPUT_PREVIEW_MAX_LENGTH
    ? text
    : // The ellipsis is one character and replaces one, so a truncated preview
      // lands exactly on the cap the schema enforces.
      `${text.slice(0, QUEUE_STATE_INPUT_PREVIEW_MAX_LENGTH - 1)}…`;
}

/**
 * The one timeline row a parked message owns. Events are append-only, so a
 * status change appends another row carrying the same `queuedMessageId`; the
 * timeline projection collapses them by that id exactly as it does
 * `system/thread-provisioning`.
 */
function appendQueueStateEvent(
  deps: QueueParkingDeps,
  args: {
    row: QueuedThreadMessageRow;
    status: SystemQueueStateStatus;
    waitingOn: QueuedMessageWaitingOn;
  },
): void {
  const inputPreview = queuedMessageInputPreview(args.row);
  appendThreadEvent(deps, {
    threadId: args.row.threadId,
    environmentId: getThread(deps.db, args.row.threadId)?.environmentId ?? null,
    type: "system/queue-state",
    scope: threadScope(),
    data: {
      queuedMessageId: args.row.id,
      status: args.status,
      waitingOn: args.waitingOn,
      sendAt: args.row.sendAt,
      ...(inputPreview === undefined ? {} : { inputPreview }),
    },
  });
}

/**
 * Appends the "this row changed while it waited" timeline write for a caller
 * that has already persisted the change itself.
 *
 * {@link parkDispatch} owns the write for a re-park because it owns the park.
 * A drain failure is the other way round: the row's own columns are what
 * changed (its wait, or its failure reason), the writer that changed them
 * returned the fresh row, and only the timeline still needs telling.
 */
export function noteQueueStateUpdated(
  deps: QueueParkingDeps,
  args: { row: QueuedThreadMessageRow; waitingOn: QueuedMessageWaitingOn },
): void {
  appendQueueStateEvent(deps, {
    row: args.row,
    status: "updated",
    waitingOn: args.waitingOn,
  });
  deps.hub.notifyThread(args.row.threadId, ["queue-changed"]);
}

/**
 * The wait a settled row reports on its final timeline write.
 *
 * A row that dispatched has just had its wait cleared, so reading the column
 * would say "nothing", which is not what the reader wants to know — they want
 * to know what it had been waiting for. The caller therefore passes the wait
 * it was holding when the drain picked it up.
 */
export interface SettleQueueRowArgs {
  row: QueuedThreadMessageRow;
  waitingOn: QueuedMessageWaitingOn;
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
  appendQueueStateEvent(deps, {
    row,
    status: leadClaim === undefined ? "parked" : "updated",
    waitingOn: args.waitingOn,
  });
  const entry = toThreadQueuedMessage(row);
  emitPluginQueueParked(entry);
  deps.hub.notifyThread(args.thread.id, ["queue-changed"]);
  return entry;
}

/**
 * Records that a parked row's waits all cleared and it dispatched. Called
 * AFTER the row is consumed, so the timeline row lands next to the turn it
 * became rather than ahead of it.
 */
export function settleQueueRowDispatched(
  deps: QueueParkingDeps,
  args: SettleQueueRowArgs,
): void {
  appendQueueStateEvent(deps, {
    row: args.row,
    status: "dispatched",
    waitingOn: args.waitingOn,
  });
  emitPluginQueueDispatched(toThreadQueuedMessage(args.row));
}

/** Records that a parked row was discarded instead of dispatched. */
export function settleQueueRowCancelled(
  deps: QueueParkingDeps,
  args: SettleQueueRowArgs,
): void {
  appendQueueStateEvent(deps, {
    row: args.row,
    status: "cancelled",
    waitingOn: args.waitingOn,
  });
  emitPluginQueueCancelled(toThreadQueuedMessage(args.row));
}

/**
 * The wait a row is parked on, for callers that only have the row.
 *
 * A live row with no `waitingOn` is an ordinary queued message behind the
 * running turn, which IS a `thread-busy` wait — it just predates waits being
 * typed, or was created through the plain queue route. Naming it rather than
 * returning null keeps every settle and every renderer on one vocabulary.
 */
export function queuedMessageWaitingOn(
  row: QueuedThreadMessageRow,
): QueuedMessageWaitingOn {
  return toThreadQueuedMessage(row).waitingOn ?? { kind: "thread-busy" };
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
