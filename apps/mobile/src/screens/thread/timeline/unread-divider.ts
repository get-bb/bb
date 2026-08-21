import type { TimelineListItem } from "./rows";

/**
 * Unread divider policy (mirrors apps/app/src/views/thread-detail/
 * useThreadUnreadDividerState.ts + `findUnreadDividerIndex` in
 * ThreadTimelineRows.tsx), kept pure so the snapshot rules can be tested:
 *
 * - A thread never read shows the divider before its first row; one read
 *   before its latest attention shows it before the first agent/system row
 *   created after `lastReadAt`.
 * - The placement is snapshotted when the thread is first tracked and held
 *   while `latestAttentionAt` is unchanged — marking the thread read on open
 *   must not make the divider vanish under the reader.
 * - `autoScroll` is true only for the first snapshot of a thread with a
 *   divider: the list scrolls to it once instead of to the bottom.
 * - New attention while open re-snapshots (no auto-scroll); a manual
 *   mark-unread moves the divider to the top but keeps the scroll decision.
 */

export type UnreadDividerPlacement =
  | { kind: "after-cutoff"; cutoffAt: number }
  | { kind: "before-first" };

export interface UnreadDividerThread {
  id: string;
  lastReadAt: number | null;
  latestAttentionAt: number;
}

export interface UnreadDividerSnapshot {
  attentionAt: number;
  autoScroll: boolean;
  placement: UnreadDividerPlacement | null;
  threadId: string;
}

export interface UnreadDividerState {
  autoScroll: boolean;
  placement: UnreadDividerPlacement | null;
}

const NO_UNREAD_DIVIDER_STATE: UnreadDividerState = {
  autoScroll: false,
  placement: null,
};

function isThreadUnread(thread: UnreadDividerThread): boolean {
  return (
    thread.lastReadAt === null || thread.lastReadAt < thread.latestAttentionAt
  );
}

export function buildUnreadDividerPlacement(
  thread: UnreadDividerThread,
): UnreadDividerPlacement | null {
  if (thread.lastReadAt === null) return { kind: "before-first" };
  if (thread.lastReadAt < thread.latestAttentionAt) {
    return { kind: "after-cutoff", cutoffAt: thread.lastReadAt };
  }
  return null;
}

/** Next snapshot for a thread update (`current` is the held snapshot). */
export function reduceUnreadDividerSnapshot(
  current: UnreadDividerSnapshot | null,
  thread: UnreadDividerThread,
): UnreadDividerSnapshot {
  const isFirstTrackedState =
    current === null || current.threadId !== thread.id;
  if (
    current !== null &&
    current.threadId === thread.id &&
    current.attentionAt === thread.latestAttentionAt
  ) {
    if (thread.lastReadAt === null) {
      // Manual mark-unread: the divider moves to the top; keep the scroll
      // decision that was already made. Idempotent so callers can reduce
      // on every render.
      const autoScroll = current.placement !== null && current.autoScroll;
      if (
        current.placement?.kind === "before-first" &&
        current.autoScroll === autoScroll
      ) {
        return current;
      }
      return {
        attentionAt: thread.latestAttentionAt,
        autoScroll,
        placement: { kind: "before-first" },
        threadId: thread.id,
      };
    }
    return current;
  }
  const placement = buildUnreadDividerPlacement(thread);
  return {
    attentionAt: thread.latestAttentionAt,
    autoScroll: isFirstTrackedState && placement !== null,
    placement,
    threadId: thread.id,
  };
}

/** The divider state to render for the held snapshot and the live thread. */
export function resolveUnreadDividerState(
  snapshot: UnreadDividerSnapshot | null,
  thread: UnreadDividerThread | undefined,
): UnreadDividerState {
  if (
    !thread ||
    snapshot === null ||
    snapshot.threadId !== thread.id ||
    (snapshot.attentionAt !== thread.latestAttentionAt &&
      !isThreadUnread(thread))
  ) {
    return NO_UNREAD_DIVIDER_STATE;
  }
  return {
    autoScroll: snapshot.autoScroll && snapshot.placement !== null,
    placement: snapshot.placement,
  };
}

function isUserAuthoredConversationItem(item: TimelineListItem): boolean {
  return item.kind === "conversation:user" && item.row.initiator === "user";
}

/**
 * Index of the first top-level item the divider sits above, or -1. The user's
 * own messages never start the unread run (they wrote them); the first
 * agent/system row after the cutoff does.
 */
export function findUnreadDividerIndex(
  items: readonly TimelineListItem[],
  placement: UnreadDividerPlacement | null,
): number {
  if (placement === null) return -1;
  switch (placement.kind) {
    case "before-first":
      return items.length > 0 ? 0 : -1;
    case "after-cutoff":
      return items.findIndex(
        (item) =>
          item.depth === 0 &&
          item.viewRow.createdAt > placement.cutoffAt &&
          !isUserAuthoredConversationItem(item),
      );
  }
}
