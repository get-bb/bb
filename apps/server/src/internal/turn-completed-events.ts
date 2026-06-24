import {
  closeAutomationRun,
  getRunningAutomationRunByThread,
  getThread,
  hasRootStoredTurnStarted,
} from "@bb/db";
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

export function applyTurnCompletedEvent(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
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

  if (nextStatus) {
    closeAutomationRunForSettledThread(deps, payload);
  }

  return { isRootTurnCompletion, nextStatus, thread };
}

/**
 * When a settled thread is the run artifact of an agent-mode automation, close
 * its still-running run row with the terminal turn status and notify the project.
 */
function closeAutomationRunForSettledThread(
  deps: Pick<AppDeps, "db" | "hub">,
  payload: Extract<ThreadEvent, { type: "turn/completed" }>,
): void {
  const run = getRunningAutomationRunByThread(deps.db, payload.threadId);
  if (!run) {
    return;
  }
  const closed = closeAutomationRun(deps.db, {
    runId: run.id,
    status: payload.status === "completed" ? "succeeded" : "failed",
    error: payload.status === "completed" ? null : `Turn ${payload.status}`,
    threadId: payload.threadId,
    now: Date.now(),
  });
  if (closed) {
    const thread = getThread(deps.db, payload.threadId);
    if (thread) {
      deps.hub.notifyProject(thread.projectId, [
        "automations-changed",
        "automation-runs-changed",
      ]);
    }
  }
}
