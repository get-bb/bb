import { useState } from "react";
import {
  reduceUnreadDividerSnapshot,
  resolveUnreadDividerState,
  type UnreadDividerSnapshot,
  type UnreadDividerState,
  type UnreadDividerThread,
} from "./timeline/unread-divider";

/**
 * Holds the unread-divider snapshot for the open thread (policy in
 * `timeline/unread-divider.ts`). `thread` is the live thread; pass undefined
 * until it is loaded.
 */
export function useThreadUnreadDividerState(
  thread: UnreadDividerThread | undefined,
): UnreadDividerState {
  const [snapshot, setSnapshot] = useState<UnreadDividerSnapshot | null>(null);
  // Derived state, adjusted during render (no effect round trip): the reducer
  // returns the held snapshot when nothing changed, so this settles at once.
  const next = thread ? reduceUnreadDividerSnapshot(snapshot, thread) : null;
  if (next !== snapshot) setSnapshot(next);
  return resolveUnreadDividerState(next, thread);
}
