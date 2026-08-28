export interface WatchError {
  message: string;
}

export function toWatchErrorMessage(error: WatchError): string {
  return error.message.trim().length > 0
    ? error.message
    : "Unknown watch error";
}
