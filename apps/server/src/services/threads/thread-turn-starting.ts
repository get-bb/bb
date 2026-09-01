import { getThread, type ClaimedQueuedThreadMessageRow } from "@bb/db";
import type {
  QueuedMessageWaitingOn,
  Thread,
  ThreadQueuedMessage,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  recordQueuedMessageWait,
  type QueuedDispatchMessage,
} from "./queue-waits.js";
import { getActiveTurnId } from "./thread-events.js";

type TurnStartingDeps = Pick<AppDeps, "db" | "hub" | "logger">;

export type QueueInputForStartingTurnResult =
  | { kind: "continue" }
  | { kind: "dispatched" }
  | { kind: "queued"; entry: ThreadQueuedMessage }
  | { kind: "thread-changed"; thread: Thread | null };

export function queueInputForStartingTurn(
  deps: TurnStartingDeps,
  args: {
    claimed: readonly ClaimedQueuedThreadMessageRow[] | null;
    fallbackWaitingOn: QueuedMessageWaitingOn | null;
    input: QueuedDispatchMessage;
    threadId: string;
  },
): QueueInputForStartingTurnResult {
  if (args.input.input.length === 0) return { kind: "dispatched" };
  const notifications = new NotificationBuffer();
  const outcome: QueueInputForStartingTurnResult = deps.db.transaction(
    (tx) => {
      const thread = getThread(tx, args.threadId);
      if (
        !thread ||
        thread.archivedAt !== null ||
        thread.deletedAt !== null ||
        thread.status === "stopping"
      ) {
        return { kind: "thread-changed", thread };
      }
      const waitingOn =
        thread.status === "active"
          ? getActiveTurnId({ db: tx }, args.threadId) === null
            ? { kind: "turn-starting" as const }
            : null
          : args.fallbackWaitingOn;
      if (waitingOn === null) {
        return thread.status === "active"
          ? { kind: "continue" }
          : { kind: "thread-changed", thread };
      }
      const entry = recordQueuedMessageWait(
        { db: tx, hub: notifications },
        {
          thread,
          message: args.input,
          waitingOn,
          sendAt: null,
          claimed: args.claimed,
        },
      );
      return entry === null
        ? { kind: "dispatched" }
        : { kind: "queued", entry };
    },
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  if (outcome.kind === "queued") {
    deps.logger.info(
      { queuedMessageId: outcome.entry.id, threadId: args.threadId },
      "Queued input until the current turn starts",
    );
  }
  return outcome;
}
