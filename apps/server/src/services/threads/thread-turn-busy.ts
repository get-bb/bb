import {
  createQueuedThreadMessageInTransaction,
  getThread,
  restoreConsumedQueuedThreadMessagesInTransaction,
  type ClaimedQueuedThreadMessageRow,
  type DbTransaction,
} from "@bb/db";
import type {
  PermissionMode,
  PromptInput,
  SystemMessageKind,
  SystemMessageSubject,
} from "@bb/domain";
import { THREAD_TURN_BUSY_ERROR_CODE } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { deferThreadMessage } from "./deferred-thread-messages.js";
import { getActiveTurnId } from "./thread-events.js";

/**
 * The daemon's answer when a turn submission cannot take the thread: its
 * runtime already has a turn active or starting on it, or the bridge refused
 * the input because its provider is mid-run (pi while it compacts). The live
 * turn is untouched, so the server keeps the thread active and parks the
 * input instead of failing the run (#2370): a send goes to the thread's
 * queue, a consumed queued group goes back to the head of the queue, and a
 * parent system message is held until that turn is no longer the live one.
 */
export function isThreadTurnBusyError(error: unknown): boolean {
  return (
    error instanceof ApiError && error.body.code === THREAD_TURN_BUSY_ERROR_CODE
  );
}

export interface BusyTurnRequeueInput {
  /** The input as the sender gave it: no cross-thread envelope, no resolved mention context. */
  content: PromptInput[];
  senderThreadId: string | null;
  model: string;
  reasoningLevel: string;
  permissionMode: PermissionMode;
  serviceTier: string;
}

interface RequeueInputForBusyTurnArgs {
  input: BusyTurnRequeueInput;
  threadId: string;
}

type BusyTurnDeps = Pick<AppDeps, "db" | "hub" | "logger">;

function withLiveThread(
  deps: BusyTurnDeps,
  threadId: string,
  work: (tx: DbTransaction) => void,
): boolean {
  return deps.db.transaction(
    (tx) => {
      const thread = getThread(tx, threadId);
      if (!thread || thread.deletedAt !== null) {
        return false;
      }
      work(tx);
      return true;
    },
    { behavior: "immediate" },
  );
}

/**
 * Queue the input of a busy-refused send behind whatever the thread's queue
 * already holds (arrival order, like a message queued up front). The raw
 * payload is what goes back: the drain re-applies the sender envelope and
 * resolves plugin mentions exactly once, so nothing is delivered twice or
 * stripped.
 */
export function requeueInputForBusyTurn(
  deps: BusyTurnDeps,
  args: RequeueInputForBusyTurnArgs,
): void {
  // A queued row needs content to deliver; an empty send only ever carried
  // its envelope, which the drain would rebuild from nothing.
  if (args.input.content.length === 0) {
    return;
  }
  const queued = withLiveThread(deps, args.threadId, (tx) => {
    createQueuedThreadMessageInTransaction(tx, {
      threadId: args.threadId,
      ...args.input,
    });
  });
  if (!queued) {
    return;
  }
  deps.hub.notifyThread(args.threadId, ["queue-changed"]);
  deps.logger.info(
    { threadId: args.threadId },
    "Queued input the provider was too busy to take",
  );
}

interface RestoreQueuedMessagesForBusyTurnArgs {
  /** The group exactly as the auto-send claimed and consumed it. */
  queuedMessages: readonly ClaimedQueuedThreadMessageRow[];
  threadId: string;
}

/**
 * Put a consumed queued group back at the head of the queue, with its
 * grouping, so it drains again ahead of everything the thread holds: what was
 * queued behind it and what arrived while the refusal was in flight. A sender
 * that queued "do X" then "stop, do Y" keeps that order. The idle auto-drain
 * always consumes the head, so the head is the group's original place; a
 * "send now" on a row further back was the user asking for it next.
 */
export function restoreQueuedMessagesForBusyTurn(
  deps: BusyTurnDeps,
  args: RestoreQueuedMessagesForBusyTurnArgs,
): void {
  const restored = withLiveThread(deps, args.threadId, (tx) => {
    restoreConsumedQueuedThreadMessagesInTransaction(tx, {
      queuedMessages: args.queuedMessages,
    });
  });
  if (!restored) {
    return;
  }
  deps.hub.notifyThread(args.threadId, ["queue-changed"]);
  deps.logger.info(
    { count: args.queuedMessages.length, threadId: args.threadId },
    "Restored queued messages the provider was too busy to take",
  );
}

interface HoldParentSystemMessageForBusyTurnArgs {
  input: PromptInput[];
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
  threadId: string;
}

/**
 * A parent system message (a child's completion notice to its orchestrator)
 * has no queue row shape: the queue would deliver it as a user message and
 * drop its taxonomy. It waits in `deferred_thread_messages` instead, stamped
 * with the turn it was refused for, and the flush skips it while that is
 * still the thread's live turn (one attempt per turn, not one per sweep).
 */
export function holdParentSystemMessageForBusyTurn(
  deps: Pick<AppDeps, "db" | "logger">,
  args: HoldParentSystemMessageForBusyTurnArgs,
): void {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.deletedAt !== null) {
    return;
  }
  deferThreadMessage(deps, {
    payload: {
      kind: "parent-system",
      input: args.input,
      systemMessageKind: args.systemMessageKind,
      systemMessageSubject: args.systemMessageSubject,
      heldForTurn: { activeTurnId: getActiveTurnId(deps, args.threadId) },
    },
    reason: "turn-busy",
    threadId: args.threadId,
  });
}
