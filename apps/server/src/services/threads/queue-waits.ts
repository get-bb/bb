import {
  clearQueuedThreadMessageWaitingOn,
  clearThreadQueuedMessagesCompactFirstInTransaction,
  createQueuedThreadMessageInTransaction,
  getQueuedThreadMessage,
  markQueuedThreadMessagesSendNowInTransaction,
  requeueClaimedQueuedThreadMessages,
  requeueClaimedQueuedThreadMessagesInTransaction,
  type ClaimedQueuedThreadMessageRow,
  type DbConnection,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
  type QueuedThreadMessageRow,
} from "@bb/db";
import type {
  PromptInput,
  QueuedMessagePayload,
  QueuedMessageSystemNotice,
  QueuedMessageWaitingOn,
  ResolvedThreadExecutionOptions,
  StartedOnBehalfOf,
  Thread,
  ThreadCreateOrigin,
  ThreadQueuedMessage,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import {
  emitPluginMessageDispatched,
  emitPluginMessageQueued,
} from "../plugins/plugin-thread-events.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";
import { assertThreadHostAcceptsWork } from "./thread-host-admission.js";

type QueueWaitDeps = { db: DbQueryConnection; hub: DbNotifier };

export const QUEUED_MESSAGE_CLAIM_LOST_CODE = "queued_message_claim_lost";
export const QUEUED_MESSAGE_AUTO_SEND_PAUSED_CODE =
  "queued_message_auto_send_paused";

export function createQueuedMessageClaimLostError(): ApiError {
  return new ApiError(
    409,
    QUEUED_MESSAGE_CLAIM_LOST_CODE,
    "Queued message claim expired before it could be sent",
  );
}

export function createQueuedMessageAutoSendPausedError(): ApiError {
  return new ApiError(
    409,
    QUEUED_MESSAGE_AUTO_SEND_PAUSED_CODE,
    "Queued message auto-send was paused by a manual stop",
  );
}

/**
 * A settling row, for the plugin event its transition raises.
 *
 * A wait is narrated by the queue rows above the composer, which read the
 * row's own columns — so a settle has nothing to write down, only somebody to
 * tell.
 */
export interface SettleQueueRowArgs {
  row: QueuedThreadMessageRow;
}

/** The message a queued row will carry, as the queueing site supplies it. */
export interface QueuedDispatchMessage {
  input: PromptInput[];
  execution: ResolvedThreadExecutionOptions;
  senderThreadId: string | null;
  /**
   * The provenance of the dispatch being queued, written onto the row so the
   * drain re-decides on what the first attempt saw rather than on null.
   */
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
  requestedBy: StartedOnBehalfOf | null;
  payload: QueuedMessagePayload;
  /** Non-null only when core is queueing one of its own system notices. */
  systemNotice: QueuedMessageSystemNotice | null;
  compactFirst: boolean;
}

export interface RecordQueuedMessageWaitArgs {
  thread: Thread;
  message: QueuedDispatchMessage;
  waitingOn: QueuedMessageWaitingOn;
  /**
   * The row's scheduled instant. Passed every time the wait is written rather
   * than left alone, because writing a wait is a fresh statement of when this
   * row may run: a `time` wait sets it, a plugin wait with a `sendAt` sets it,
   * and every other wait clears it by passing null.
   */
  sendAt: number | null;
  /**
   * Rows already claimed from the queue that this call is RETURNING rather
   * than creating. Present on every drain re-attempt; absent when an inline
   * send is queued for the first time.
   */
  claimed: readonly ClaimedQueuedThreadMessageRow[] | null;
}

/**
 * Records that a dispatch is waiting: the single place a queued row comes into
 * existence or has its wait rewritten.
 *
 * Creating and re-queueing are one function because they are one concept —
 * "this message is waiting, and here is why" — and because every caller reaches
 * it from the same place in {@link attemptDispatch}. The difference is only
 * whether a row already exists: a drain re-attempt hands back the rows it
 * claimed, an inline attempt has none yet.
 *
 * Returns the row the wait now sits on, or null when a re-queue lost its row
 * (deleted under the drain), which the caller treats as "nothing to do".
 */
export function recordQueuedMessageWait(
  deps: QueueWaitDeps,
  args: RecordQueuedMessageWaitArgs,
): ThreadQueuedMessage | null {
  const claimed = args.claimed ?? [];
  if (claimed.length > 0) {
    return recordClaimedQueuedMessageWait(deps, {
      claimed,
      sendAt: args.sendAt,
      threadId: args.thread.id,
      waitingOn: args.waitingOn,
    });
  }
  return createQueuedMessageWait(deps, args);
}

export function createQueuedMessageWait(
  deps: QueueWaitDeps,
  args: Pick<
    RecordQueuedMessageWaitArgs,
    "message" | "sendAt" | "thread" | "waitingOn"
  >,
): ThreadQueuedMessage {
  const row = deps.db.transaction(
    (tx) => createQueuedMessageRowInTransaction(tx, args),
    { behavior: "immediate" },
  );
  return announceQueuedMessageWait(deps, row);
}

function createQueuedMessageRowInTransaction(
  tx: DbTransaction,
  args: Pick<
    RecordQueuedMessageWaitArgs,
    "message" | "sendAt" | "thread" | "waitingOn"
  >,
): QueuedThreadMessageRow {
  assertThreadHostAcceptsWork(tx, args.thread);
  return createQueuedThreadMessageInTransaction(tx, {
    threadId: args.thread.id,
    content: args.message.input,
    senderThreadId: args.message.senderThreadId,
    origin: args.message.origin,
    originPluginId: args.message.originPluginId,
    requestedBy: args.message.requestedBy,
    model: args.message.execution.model,
    reasoningLevel: args.message.execution.reasoningLevel,
    permissionMode: args.message.execution.permissionMode,
    serviceTier: args.message.execution.serviceTier,
    waitingOn: args.waitingOn,
    sendAt: args.sendAt,
    payload: args.message.payload,
    systemNotice: args.message.systemNotice,
    compactFirst: args.message.compactFirst,
  });
}

export function queueBehindCompactionInTransaction(
  tx: DbTransaction,
  args: Pick<RecordQueuedMessageWaitArgs, "claimed" | "message" | "thread"> & {
    sendNow: boolean;
  },
): QueuedThreadMessageRow {
  const waitingOn: QueuedMessageWaitingOn = { kind: "thread-busy" };
  const claimed = args.claimed ?? [];
  clearThreadQueuedMessagesCompactFirstInTransaction(tx, args.thread.id);
  if (claimed.length === 0) {
    return createQueuedMessageRowInTransaction(tx, {
      message: { ...args.message, compactFirst: false },
      sendAt: null,
      thread: args.thread,
      waitingOn,
    });
  }
  const lead = requeueClaimedQueuedThreadMessagesInTransaction(tx, {
    claims: claimed.map((claim) => ({
      id: claim.id,
      claimToken: claim.claimToken,
    })),
    threadId: args.thread.id,
    waitingOn,
    sendAt: null,
  });
  if (lead === null) throw createQueuedMessageClaimLostError();
  if (args.sendNow) {
    markQueuedThreadMessagesSendNowInTransaction(tx, {
      ids: claimed.map((claim) => claim.id),
      threadId: args.thread.id,
    });
  }
  const queued = getQueuedThreadMessage(tx, lead.id);
  if (queued === null) throw createQueuedMessageClaimLostError();
  return queued;
}

export function recordClaimedQueuedMessageWait(
  deps: QueueWaitDeps,
  args: {
    claimed: readonly Pick<
      ClaimedQueuedThreadMessageRow,
      "claimToken" | "id"
    >[];
    sendAt: number | null;
    threadId: string;
    waitingOn: QueuedMessageWaitingOn;
  },
): ThreadQueuedMessage | null {
  const row = requeueClaimedQueuedThreadMessages(deps.db, deps.hub, {
    claims: args.claimed.map((claim) => ({
      id: claim.id,
      claimToken: claim.claimToken,
    })),
    threadId: args.threadId,
    waitingOn: args.waitingOn,
    sendAt: args.sendAt,
  });
  if (row === null) {
    // The claim no longer holds: the row was deleted under the drain, or a
    // stale-claim sweep reclaimed it. Either way there is no row left to queue.
    return null;
  }
  return announceQueuedMessageWait(deps, row);
}

export function announceQueuedMessageWait(
  deps: QueueWaitDeps,
  row: QueuedThreadMessageRow,
): ThreadQueuedMessage {
  const entry = toThreadQueuedMessage(row);
  emitPluginMessageQueued(entry);
  deps.hub.notifyThread(row.threadId, ["queue-changed"]);
  return entry;
}

/**
 * Records that a queued row's waits all cleared and it dispatched. Called
 * AFTER the row is consumed, so a plugin listening on `message.dispatched` sees
 * the row leave the queue rather than a row that is about to.
 */
export function settleQueueRowDispatched(args: SettleQueueRowArgs): void {
  emitPluginMessageDispatched(toThreadQueuedMessage(args.row));
}

/**
 * Drops a row's wait so the next drain re-attempts it. The row stays exactly
 * where it is in the queue; only its eligibility changes.
 */
export function clearQueuedMessageWait(
  deps: { db: DbConnection; hub: DbNotifier },
  args: { queuedMessageId: string; threadId: string },
): QueuedThreadMessageRow | null {
  return clearQueuedThreadMessageWaitingOn(deps.db, deps.hub, {
    id: args.queuedMessageId,
    threadId: args.threadId,
  });
}
