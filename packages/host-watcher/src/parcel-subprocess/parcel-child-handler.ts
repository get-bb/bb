import path from "node:path";
import type {
  ParcelAsyncSubscription,
  ParcelWatcherBackend,
  ParcelWatcherEventBatch,
} from "../parcel-watcher-backend.js";
import type {
  ChildToParentMessage,
  ParentToChildMessage,
  SerializedParcelEvent,
} from "./messages.js";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown watch error";
}

function serializeEvents(
  events: ParcelWatcherEventBatch,
): SerializedParcelEvent[] {
  return events.map((event) => ({ path: event.path, type: event.type }));
}

export interface ParcelChildHandler {
  handleMessage(message: ParentToChildMessage): void;
  dispose(): Promise<void>;
}

/**
 * The parcel-facing half that runs inside the child process. Pure with respect
 * to its dependencies (a parcel backend, a `send` channel, and a directory
 * lister) so the protocol can be exercised in-process by tests without forking
 * or touching the filesystem.
 */
export function createParcelChildHandler(args: {
  parcel: ParcelWatcherBackend;
  send: (message: ChildToParentMessage) => void;
  listEntries: (dir: string) => Promise<string[]>;
}): ParcelChildHandler {
  const subscriptions = new Map<string, ParcelAsyncSubscription>();
  // Ids unsubscribed before their subscribe() promise resolved: tear down on
  // arrival instead of leaking a live subscription the parent no longer wants.
  const cancelledBeforeReady = new Set<string>();

  async function emitRescan(id: string, dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await args.listEntries(dir);
    } catch {
      return;
    }
    if (entries.length === 0) {
      return;
    }
    args.send({
      kind: "events",
      id,
      events: entries.map((entry) => ({
        path: path.join(dir, entry),
        type: "update",
      })),
    });
  }

  function handleSubscribe(
    message: Extract<ParentToChildMessage, { kind: "subscribe" }>,
  ): void {
    args.parcel
      .subscribe(
        message.dir,
        (error, events) => {
          if (error) {
            args.send({
              kind: "watch-error",
              id: message.id,
              message: toErrorMessage(error),
            });
            return;
          }
          args.send({
            kind: "events",
            id: message.id,
            events: serializeEvents(events),
          });
        },
        message.opts,
      )
      .then(async (subscription) => {
        if (cancelledBeforeReady.delete(message.id)) {
          void subscription.unsubscribe().catch(() => {});
          return;
        }
        subscriptions.set(message.id, subscription);
        args.send({ kind: "subscribed", id: message.id });
        if (message.rescan) {
          await emitRescan(message.id, message.dir);
        }
      })
      .catch((error: unknown) => {
        cancelledBeforeReady.delete(message.id);
        args.send({
          kind: "subscribe-failed",
          id: message.id,
          message: toErrorMessage(error),
        });
      });
  }

  async function handleUnsubscribe(id: string): Promise<void> {
    const subscription = subscriptions.get(id);
    if (subscription) {
      subscriptions.delete(id);
      try {
        await subscription.unsubscribe();
      } catch {
        // Ignore unsubscribe failures during teardown.
      }
    } else {
      cancelledBeforeReady.add(id);
    }
    args.send({ kind: "unsubscribed", id });
  }

  return {
    handleMessage(message) {
      switch (message.kind) {
        case "subscribe":
          handleSubscribe(message);
          break;
        case "unsubscribe":
          void handleUnsubscribe(message.id);
          break;
        case "ping":
          args.send({ kind: "pong", nonce: message.nonce });
          break;
      }
    },
    async dispose() {
      const pending = [...subscriptions.values()];
      subscriptions.clear();
      cancelledBeforeReady.clear();
      await Promise.all(
        pending.map((subscription) =>
          subscription.unsubscribe().catch(() => {}),
        ),
      );
    },
  };
}
