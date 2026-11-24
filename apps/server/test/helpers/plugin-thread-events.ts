import { setPluginThreadEventEmitter } from "../../src/services/plugins/plugin-thread-events.js";

export interface RecordedQueuedMessageEvent {
  event: "queued" | "dispatched" | "cancelled";
  id: string;
}

export function recordQueuedMessageEvents(): RecordedQueuedMessageEvent[] {
  const events: RecordedQueuedMessageEvent[] = [];
  const noop = () => {};
  setPluginThreadEventEmitter({
    emitEnvironmentRemoved: noop,
    emitThreadEvents: noop,
    emitTerminalInput: noop,
    emitHostDeleted: noop,
    emitThreadCreated: noop,
    emitThreadActive: noop,
    emitThreadIdle: noop,
    emitThreadFailed: noop,
    emitThreadArchived: noop,
    emitThreadUnarchived: noop,
    emitThreadParentChanged: noop,
    emitThreadDeleted: noop,
    emitThreadRead: noop,
    emitInteractionPending: noop,
    emitMessageQueued: (entry) =>
      events.push({ event: "queued", id: entry.id }),
    emitMessageDispatched: (entry) =>
      events.push({ event: "dispatched", id: entry.id }),
    emitMessageCancelled: (entry) =>
      events.push({ event: "cancelled", id: entry.id }),
    emitTurnFailed: noop,
  });
  return events;
}
