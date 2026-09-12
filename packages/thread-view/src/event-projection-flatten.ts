import type {
  EventProjectionMessage,
  EventProjectionEntry,
} from "./event-projection-types.js";

export function getProjectionEntryMessages(
  entry: EventProjectionEntry,
): readonly EventProjectionMessage[] {
  if (entry.kind === "projected-message") {
    return [entry.message];
  }
  if (entry.turn.messages) {
    return entry.turn.messages;
  }
  if (entry.turn.terminalMessage) {
    return [entry.turn.terminalMessage];
  }
  return [];
}
