export const RESCAN_REQUIRED_MESSAGE = "File system must be re-scanned";
export const EVENTS_DROPPED_MESSAGE =
  "Watcher event batch was too large to deliver";

export function isEventsDroppedMessage(message: string): boolean {
  return message === EVENTS_DROPPED_MESSAGE;
}

export function isRescanRequiredMessage(message: string): boolean {
  return message.includes(RESCAN_REQUIRED_MESSAGE);
}

export function leavesNativeWatchesBehind(message: string): boolean {
  return message.includes("inotify_add_watch");
}
