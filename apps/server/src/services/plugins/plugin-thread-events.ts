import type { ApplyThreadLifecycleEventOutcome } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { PluginThreadEventEmitter } from "./plugin-service.js";

let emitter: PluginThreadEventEmitter | undefined;

export function setPluginThreadEventEmitter(
  next: PluginThreadEventEmitter | undefined,
): void {
  emitter = next;
}

export function emitPluginThreadCreated(thread: Thread): void {
  emitter?.emitThreadCreated(thread);
}

export function emitPluginThreadArchived(thread: Thread): void {
  emitter?.emitThreadArchived(thread);
}

export function emitPluginThreadDeleted(thread: Thread): void {
  emitter?.emitThreadDeleted(thread);
}

/** Called after a dispatch attempt parks as a queued row (parkDispatch). */
export function emitPluginQueueParked(entry: ThreadQueuedMessage): void {
  emitter?.emitQueueParked(entry);
}

/** Called after a parked row's waits cleared and it dispatched. */
export function emitPluginQueueDispatched(entry: ThreadQueuedMessage): void {
  emitter?.emitQueueDispatched(entry);
}

/** Called after a parked row is cancelled and its dispatch discarded. */
export function emitPluginQueueCancelled(entry: ThreadQueuedMessage): void {
  emitter?.emitQueueCancelled(entry);
}

/**
 * Called with every lifecycle-event outcome; forwards applied transitions
 * into `active`/`idle`/`error` as their curated plugin lifecycle events.
 * Those statuses have no self-transitions in THREAD_LIFECYCLE, so an applied
 * outcome landing there always means the thread just entered the state.
 */
export function emitPluginThreadLifecycleOutcome(
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  if (emitter === undefined || !outcome.applied) return;
  if (outcome.thread.status === "active") {
    emitter.emitThreadActive(outcome.thread);
  } else if (outcome.thread.status === "idle") {
    emitter.emitThreadIdle(outcome.thread);
  } else if (outcome.thread.status === "error") {
    emitter.emitThreadFailed(outcome.thread);
  }
}
