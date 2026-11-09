import { getThread, hasRootStoredTurnStarted } from "@bb/db";
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
import { getActiveTurnId } from "../services/threads/thread-events.js";
import { rejectUnconfirmedSteersAfterTurnCompleted } from "../services/threads/unconfirmed-turn-requests.js";

type TurnCompletedEvent = Extract<ThreadEvent, { type: "turn/completed" }>;

type TurnCompletionDeps = Pick<
  AppDeps,
  "db" | "hub" | "logger" | "providerRegistry"
>;

interface ReadTurnCompletionResult {
  isRootTurnCompletion: boolean;
  thread: ReturnType<typeof getThread>;
}

export type TurnCompletedTransition =
  | { kind: "deferred" }
  | { kind: "settled"; nextStatus: ThreadStatus | null };

interface ApplyTurnCompletedEventArgs {
  afterIdle: (() => Promise<void>) | null;
  payload: TurnCompletedEvent;
}

interface DeferredTurnCompletion {
  afterIdle: (() => Promise<void>) | null;
  lifecycleEvent: ThreadLifecycleEvent;
}

const inFlightTurnRequestCountByThreadId = new Map<string, number>();
const deferredTurnCompletionByThreadId = new Map<
  string,
  DeferredTurnCompletion
>();

function lifecycleEventForTurnCompletion(
  status: TurnCompletedEvent["status"],
): ThreadLifecycleEvent {
  if (status === "failed") {
    return { type: "run.failed" };
  }
  if (status === "interrupted") {
    return { type: "stop.settled" };
  }
  return { type: "run.succeeded" };
}

export function readTurnCompletion(
  deps: Pick<AppDeps, "db">,
  payload: TurnCompletedEvent,
): ReadTurnCompletionResult {
  const thread = getThread(deps.db, payload.threadId);
  if (!thread) {
    return { isRootTurnCompletion: false, thread: null };
  }
  const turnId = requireThreadEventScopeTurnId({
    type: payload.type,
    scope: payload.scope,
  });
  return {
    isRootTurnCompletion: hasRootStoredTurnStarted(deps.db, {
      threadId: payload.threadId,
      turnId,
    }),
    thread,
  };
}

function applyTurnCompletion(
  deps: TurnCompletionDeps,
  threadId: string,
  lifecycleEvent: ThreadLifecycleEvent,
): ThreadStatus | null {
  const outcome = applyLoggedThreadLifecycleEvent(deps, {
    event: lifecycleEvent,
    threadId,
  });
  const nextStatus = outcome.applied ? outcome.thread.status : null;
  if (nextStatus) {
    resetActiveThreadEventPruningState(threadId);
  }
  if (nextStatus === "idle") {
    pruneThreadEventHistoryBestEffort(deps, { mode: "idle", threadId });
  }
  return nextStatus;
}

export function applyTurnCompletedEvent(
  deps: TurnCompletionDeps,
  { afterIdle, payload }: ApplyTurnCompletedEventArgs,
): TurnCompletedTransition {
  rejectUnconfirmedSteersAfterTurnCompleted(deps, payload.threadId);
  const lifecycleEvent = lifecycleEventForTurnCompletion(payload.status);
  if (inFlightTurnRequestCountByThreadId.has(payload.threadId)) {
    deferredTurnCompletionByThreadId.set(payload.threadId, {
      afterIdle,
      lifecycleEvent,
    });
    return { kind: "deferred" };
  }
  return {
    kind: "settled",
    nextStatus: applyTurnCompletion(deps, payload.threadId, lifecycleEvent),
  };
}

export function trackInFlightTurnRequest(threadId: string): void {
  inFlightTurnRequestCountByThreadId.set(
    threadId,
    (inFlightTurnRequestCountByThreadId.get(threadId) ?? 0) + 1,
  );
}

export async function settleInFlightTurnRequest(
  deps: TurnCompletionDeps,
  threadId: string,
): Promise<void> {
  const count = inFlightTurnRequestCountByThreadId.get(threadId) ?? 0;
  if (count > 1) {
    inFlightTurnRequestCountByThreadId.set(threadId, count - 1);
    return;
  }
  inFlightTurnRequestCountByThreadId.delete(threadId);
  const completion = deferredTurnCompletionByThreadId.get(threadId);
  if (completion === undefined) {
    return;
  }
  deferredTurnCompletionByThreadId.delete(threadId);
  if (getActiveTurnId(deps, threadId) !== null) {
    return;
  }
  const nextStatus = applyTurnCompletion(
    deps,
    threadId,
    completion.lifecycleEvent,
  );
  if (nextStatus === "idle") {
    await completion.afterIdle?.();
  }
}
