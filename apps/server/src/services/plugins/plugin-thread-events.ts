import type { ApplyThreadLifecycleEventOutcome } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { PluginThreadEventEmitter } from "./plugin-service.js";

/**
 * Module-level bridge from the thread lifecycle seams to the plugin service
 * (design §4.5). The lifecycle choke points (`lifecycle-outcome.ts`,
 * `createThreadRecord`) receive narrow `{ db, hub, logger }` deps assembled
 * long before the plugin service exists, so instead of threading a
 * pluginService reference through every deps object, createApp registers the
 * one emitter here. Unset (tests that never build an app) every call is a
 * no-op; with no handlers registered the emitter itself is a cheap no-op.
 */
let emitter: PluginThreadEventEmitter | undefined;

export function setPluginThreadEventEmitter(
  next: PluginThreadEventEmitter | undefined,
): void {
  emitter = next;
}

/** Called after a thread row is inserted (createThreadRecord). */
export function emitPluginThreadCreated(thread: Thread): void {
  emitter?.emitThreadCreated(thread);
}

/**
 * Called with every lifecycle-event outcome; forwards applied transitions
 * into `idle`/`error` as thread.idle / thread.failed. Those statuses have no
 * self-transitions in THREAD_LIFECYCLE, so an applied outcome landing there
 * always means the thread just entered the state.
 */
export function emitPluginThreadLifecycleOutcome(
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  if (emitter === undefined || !outcome.applied) return;
  if (outcome.thread.status === "idle") {
    emitter.emitThreadIdle(outcome.thread);
  } else if (outcome.thread.status === "error") {
    emitter.emitThreadFailed(outcome.thread);
  }
}
