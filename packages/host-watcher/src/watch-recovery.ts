export const RESCAN_REQUIRED_MESSAGE = "File system must be re-scanned";

export function isRescanRequiredMessage(message: string): boolean {
  return message.includes(RESCAN_REQUIRED_MESSAGE);
}

export function leavesNativeWatchesBehind(message: string): boolean {
  return message.includes("inotify_add_watch");
}
