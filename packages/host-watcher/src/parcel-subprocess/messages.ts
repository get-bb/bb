import type { ParcelWatcherSubscribeOptions } from "../parcel-watcher-backend.js";

// Wire protocol between the host-daemon parent and the parcel watcher child.
// Every payload must be structured-clone / JSON safe (no functions, no Error
// instances) — parcel events already are ({path, type}); errors travel as their
// message string and are rehydrated into an Error on the parent side.

export interface SerializedParcelEvent {
  path: string;
  type: "create" | "update" | "delete";
}

export type ParentToChildMessage =
  | {
      kind: "subscribe";
      id: string;
      dir: string;
      opts?: ParcelWatcherSubscribeOptions;
      // Set when re-subscribing onto a freshly respawned child. The child
      // re-emits the root's current entries once the watch is armed so callers
      // reconcile against on-disk state and recover changes missed during the
      // restart gap (mirrors watch-path's dropped-events rescan).
      rescan?: boolean;
    }
  | { kind: "unsubscribe"; id: string }
  | { kind: "ping"; nonce: number };

export type ChildToParentMessage =
  | { kind: "ready" }
  | { kind: "pong"; nonce: number }
  | { kind: "subscribed"; id: string }
  | { kind: "subscribe-failed"; id: string; message: string }
  | { kind: "unsubscribed"; id: string }
  | { kind: "events"; id: string; events: SerializedParcelEvent[] }
  | { kind: "watch-error"; id: string; message: string };
