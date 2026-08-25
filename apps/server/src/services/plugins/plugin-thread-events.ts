import type { ApplyThreadLifecycleEventOutcome } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { DispatchHoldResponse } from "@bb/server-contract";
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

/** Called after a dispatch hold row is created (createThreadDispatchHold). */
export function emitPluginDispatchHeld(hold: DispatchHoldResponse): void {
  emitter?.emitDispatchHeld(hold);
}

/** Called after a hold is released into its dispatch (settleDispatchHold). */
export function emitPluginDispatchReleased(hold: DispatchHoldResponse): void {
  emitter?.emitDispatchReleased(hold);
}

/** Called after a live hold is cancelled and its dispatch discarded. */
export function emitPluginDispatchCancelled(hold: DispatchHoldResponse): void {
  emitter?.emitDispatchCancelled(hold);
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
