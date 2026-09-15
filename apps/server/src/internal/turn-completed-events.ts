import {
  deleteQueuedThreadMessage,
  findLastRootStoredTurnStarted,
  getLastStoredTurnRequestEvent,
  getLatestStoredThreadEventOfTypes,
  getStoredTurnRequestEventForTurn,
  getThread,
  hasRootStoredTurnStarted,
  queuedThreadMessages,
} from "@bb/db";
import { and, eq } from "drizzle-orm";
import { emitPluginMessageCancelled } from "../services/plugins/plugin-thread-events.js";
import { parseStoredTurnRequestEvent } from "../services/threads/thread-events.js";
import { toThreadQueuedMessage } from "../services/threads/thread-queued-messages.js";
import {
  requireThreadEventScopeTurnId,
  systemThreadInterruptedEventDataSchema,
  systemErrorEventDataSchema,
  type ThreadEvent,
  type ThreadLifecycleEvent,
  type ThreadStatus,
} from "@bb/domain";
import type { AppDeps } from "../types.js";
import {
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../services/system/event-pruning.js";
import { applyLoggedThreadLifecycleEvent } from "../services/threads/lifecycle-outcome.js";

interface ApplyTurnCompletedEventResult {
  isRootTurnCompletion: boolean;
  nextStatus: ThreadStatus | null;
  thread: ReturnType<typeof getThread>;
}

function lifecycleEventForTurnCompletion(
  status: Extract<ThreadEvent, { type: "turn/completed" }>["status"],
): ThreadLifecycleEvent {
  if (status === "failed") {
    return { type: "run.failed" };
  }
  if (status === "interrupted") {
    return { type: "stop.settled" };
  }
  return { type: "run.succeeded" };
}

function isCompletedHostInterruption(
  deps: Pick<AppDeps, "db">,
  threadId: string,
  turnId: string,
  requestSequence: number,
): boolean {
  const interruption = getLatestStoredThreadEventOfTypes(deps.db, {
    threadId,
    afterSequence: requestSequence,
    types: [
      "system/thread/interrupted",
      "system/error",
      "provider/error",
      "client/turn/rejected",
      "client/turn/requested",
      "turn/started",
    ],
  });
  if (interruption?.type !== "system/thread/interrupted") return false;
  const error = getLatestStoredThreadEventOfTypes(deps.db, {
    threadId,
    afterSequence: requestSequence,
    types: ["system/error"],
  });
  if (
    !error ||
    error.turnId !== turnId ||
    error.sequence >= interruption.sequence
  )
    return false;
  try {
    return (
      systemThreadInterruptedEventDataSchema.parse(
        JSON.parse(interruption.data),
      ).reason === "host-daemon-restarted" &&
      systemErrorEventDataSchema.parse(JSON.parse(error.data)).code ===
        "thread_command_failed"
    );
  } catch {
    return false;
  }
}

export function applyTurnCompletedEvent(
  deps: Pick<AppDeps, "db" | "hub" | "logger" | "providerRegistry">,
  payload: Extract<ThreadEvent, { type: "turn/completed" }>,
): ApplyTurnCompletedEventResult {
  const thread = getThread(deps.db, payload.threadId);
  if (!thread) {
    return { isRootTurnCompletion: false, nextStatus: null, thread: null };
  }

  const turnId = requireThreadEventScopeTurnId({
    type: payload.type,
    scope: payload.scope,
  });
  const isRootTurnCompletion = hasRootStoredTurnStarted(deps.db, {
    threadId: payload.threadId,
    turnId,
  });
  if (!isRootTurnCompletion) {
    return { isRootTurnCompletion, nextStatus: null, thread };
  }

  const latestTurn = findLastRootStoredTurnStarted(deps.db, {
    threadId: payload.threadId,
  });
  const acceptedRequest = getStoredTurnRequestEventForTurn(deps.db, {
    threadId: payload.threadId,
    turnId,
  });
  const latestRequest = getLastStoredTurnRequestEvent(
    deps.db,
    payload.threadId,
  );
  const completedRequest =
    payload.status === "completed" &&
    acceptedRequest &&
    acceptedRequest.sequence === latestRequest?.sequence
      ? parseStoredTurnRequestEvent(acceptedRequest)
      : null;
  if (completedRequest) {
    const obsoleteRetries = deps.db
      .select()
      .from(queuedThreadMessages)
      .where(
        and(
          eq(queuedThreadMessages.threadId, payload.threadId),
          eq(queuedThreadMessages.payloadKind, "retry"),
          eq(
            queuedThreadMessages.retryOfTurnRequestId,
            completedRequest.retryOfRequestId ?? completedRequest.requestId,
          ),
        ),
      )
      .all();
    for (const retry of obsoleteRetries) {
      if (deleteQueuedThreadMessage(deps.db, deps.hub, retry.id)) {
        emitPluginMessageCancelled(toThreadQueuedMessage(retry));
      }
    }
  }

  if (
    latestTurn?.turnId !== turnId ||
    (latestRequest &&
      latestRequest.sequence >
        (acceptedRequest?.sequence ?? latestTurn.sequence))
  ) {
    return { isRootTurnCompletion, nextStatus: null, thread };
  }
  const recovered =
    thread.status === "error" &&
    completedRequest &&
    acceptedRequest &&
    isCompletedHostInterruption(
      deps,
      payload.threadId,
      turnId,
      acceptedRequest.sequence,
    );
  const outcome = applyLoggedThreadLifecycleEvent(deps, {
    event: recovered
      ? { type: "run.reconciled" }
      : lifecycleEventForTurnCompletion(payload.status),
    threadId: payload.threadId,
  });
  const nextStatus = outcome.applied ? outcome.thread.status : null;

  if (nextStatus) {
    resetActiveThreadEventPruningState(payload.threadId);
  }

  if (nextStatus === "idle") {
    pruneThreadEventHistoryBestEffort(deps, {
      mode: "idle",
      threadId: payload.threadId,
    });
  }

  return { isRootTurnCompletion, nextStatus, thread };
}
