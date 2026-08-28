import type { ApplyThreadLifecycleEventOutcome } from "@bb/db";
import type { Thread } from "@bb/domain";
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
