const INOTIFY_WATCH_LIMIT_HINT =
  "inotify watch limit reached; see fs.inotify.max_user_watches";

export function toWatchErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Unknown watch error";
}

export function describeSubscribeFailure(message: string): string {
  if (
    message.includes("inotify_add_watch") &&
    message.includes("No space left on device") &&
    !message.includes(INOTIFY_WATCH_LIMIT_HINT)
  ) {
    return `${message} (${INOTIFY_WATCH_LIMIT_HINT})`;
  }
  return message;
}
