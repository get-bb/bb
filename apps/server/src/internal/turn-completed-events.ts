import { getThread, findLastRootStoredTurnStarted } from "@bb/db";
import {
  requireThreadEventScopeTurnId,
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
  isCurrentRootTurnCompletion: boolean;
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
    return { type: "run.interrupted" };
  }
  return { type: "run.succeeded" };
}

export function applyTurnCompletedEvent(
  deps: Pick<AppDeps, "db" | "hub" | "logger" | "providerRegistry">,
  payload: Extract<ThreadEvent, { type: "turn/completed" }>,
): ApplyTurnCompletedEventResult {
  const thread = getThread(deps.db, payload.threadId);
  if (!thread) {
    return {
      isCurrentRootTurnCompletion: false,
      nextStatus: null,
      thread: null,
    };
  }

  const turnId = requireThreadEventScopeTurnId({
    type: payload.type,
    scope: payload.scope,
  });
  const isCurrentRootTurnCompletion =
    findLastRootStoredTurnStarted(deps.db, {
      threadId: payload.threadId,
    })?.turnId === turnId;
  if (!isCurrentRootTurnCompletion) {
    return { isCurrentRootTurnCompletion, nextStatus: null, thread };
  }

  const outcome = applyLoggedThreadLifecycleEvent(deps, {
    event: lifecycleEventForTurnCompletion(payload.status),
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

  return { isCurrentRootTurnCompletion, nextStatus, thread };
}
