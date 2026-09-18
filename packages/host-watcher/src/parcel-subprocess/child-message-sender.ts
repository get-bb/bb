import { RESCAN_REQUIRED_MESSAGE } from "../watch-recovery.js";
import type { ChildToParentMessage } from "./messages.js";

const MAX_PENDING_EVENT_BYTES = 4 * 1024 * 1024;

export function createChildMessageSender(args: {
  send: (
    message: ChildToParentMessage,
    callback: (error: Error | null) => void,
  ) => void;
  onError: (error: Error) => void;
}): (message: ChildToParentMessage) => void {
  let pendingEventBytes = 0;
  let failed = false;
  const recoveringSubscriptions = new Set<string>();

  function fail(error: Error): void {
    if (failed) {
      return;
    }
    failed = true;
    recoveringSubscriptions.clear();
    args.onError(error);
  }

  function send(message: ChildToParentMessage, eventBytes = 0): void {
    if (failed) {
      return;
    }
    pendingEventBytes += eventBytes;
    try {
      args.send(message, (error) => {
        pendingEventBytes -= eventBytes;
        if (error) {
          fail(error);
          return;
        }
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return (message) => {
    if (failed) {
      return;
    }
    if (
      message.kind === "unsubscribed" ||
      message.kind === "subscribe-failed"
    ) {
      recoveringSubscriptions.delete(message.id);
    }
    if (message.kind !== "events") {
      send(message);
      return;
    }
    if (
      message.events.length === 0 ||
      recoveringSubscriptions.has(message.id)
    ) {
      return;
    }
    let eventBytes = 128 + message.id.length * 6;
    for (const event of message.events) {
      eventBytes += 64 + event.path.length * 6;
      if (pendingEventBytes + eventBytes > MAX_PENDING_EVENT_BYTES) {
        recoveringSubscriptions.add(message.id);
        send({
          kind: "watch-error",
          id: message.id,
          message: `${RESCAN_REQUIRED_MESSAGE}: watcher IPC backlog exceeded`,
          recovery: "rescan-subscription",
        });
        return;
      }
    }
    send(message, eventBytes);
  };
}
