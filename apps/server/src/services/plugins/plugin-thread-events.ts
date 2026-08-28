import type { ApplyThreadLifecycleEventOutcome } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { ThreadQueuedMessage } from "@bb/domain";
import { noteThreadCapacityFreed } from "../threads/freed-capacity-signal.js";
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

/**
 * Called after a thread is archived (archiveThreadWithLifecycleEffects).
 *
 * Also core's own signal that a slot may have freed — archiving a running
 * thread stops it. These four functions are already THE fanout for "a thread
 * stopped occupying capacity", which is precisely the set the concurrency
 * limiter used to subscribe to; core consumes the signal here instead of
 * asking every limiter to re-derive it and call back in.
 */
export function emitPluginThreadArchived(thread: Thread): void {
  emitter?.emitThreadArchived(thread);
  noteThreadCapacityFreed();
}

export function emitPluginThreadDeleted(thread: Thread): void {
  emitter?.emitThreadDeleted(thread);
  noteThreadCapacityFreed();
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
 * into `active`/`idle`/`error` as their curated plugin lifecycle events, and
 * tells core when one of them freed capacity.
 * Those statuses have no self-transitions in THREAD_LIFECYCLE, so an applied
 * outcome landing there always means the thread just entered the state.
 */
export function emitPluginThreadLifecycleOutcome(
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  if (!outcome.applied) return;
  if (outcome.thread.status === "active") {
    emitter?.emitThreadActive(outcome.thread);
  } else if (outcome.thread.status === "idle") {
    emitter?.emitThreadIdle(outcome.thread);
    noteThreadCapacityFreed();
  } else if (outcome.thread.status === "error") {
    emitter?.emitThreadFailed(outcome.thread);
    noteThreadCapacityFreed();
  }
}
