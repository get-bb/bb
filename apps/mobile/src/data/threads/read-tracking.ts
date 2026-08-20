import { isThreadRead, type ThreadReadState } from "@bb/client-core";
import type { Thread } from "@bb/domain";

/**
 * Decides when an open thread should be marked read (mirrors
 * apps/app/src/hooks/useThreadReadTracking.ts). Pure so the policy is
 * testable without React: feed it snapshots (thread + whether the app is
 * in the foreground) and it calls `markRead` when — and only when — a
 * fresh read receipt is due:
 *
 * - opening a thread that is unread;
 * - new attention arriving while it is open and visible;
 * - the app returning to the foreground with the thread still unread;
 * - a retry after a failed receipt.
 *
 * It does not re-mark a thread the user just marked unread by hand while it
 * stayed open with no new attention, and it never sends two receipts for
 * the same (thread, latestAttentionAt) while one is in flight.
 */

export type ThreadReadTrackingThread = ThreadReadState & Pick<Thread, "id">;

export type MarkThreadReadFn = (
  threadId: string,
  callbacks: ThreadReadTrackerCallbacks,
) => void;

export interface ThreadReadTrackerInput {
  thread: ThreadReadTrackingThread | undefined;
  /** Foreground and on screen (AppState active + screen focused). */
  isVisible: boolean;
  /** Sends the receipt; the tracker wires `onError`/`onSettled` for retries. */
  markRead: MarkThreadReadFn;
}

export interface ThreadReadTrackerCallbacks {
  onError: () => void;
  onSettled: () => void;
}

export interface ThreadReadTracker {
  /** Call on every relevant change; returns whether a receipt was requested. */
  update(input: ThreadReadTrackerInput): boolean;
}

interface Snapshot {
  isVisible: boolean;
  isRead: boolean | null;
  latestAttentionAt: number | null;
  threadId: string | null;
}

export function createThreadReadTracker(): ThreadReadTracker {
  const failedKeys = new Set<string>();
  const pendingKeys = new Set<string>();
  const suppressedManualUnreadKeys = new Set<string>();
  let previous: Snapshot | null = null;

  return {
    update({ thread, isVisible, markRead }) {
      const before = previous;
      const threadIsRead = thread ? isThreadRead(thread) : null;
      previous = {
        isVisible,
        isRead: threadIsRead,
        latestAttentionAt: thread?.latestAttentionAt ?? null,
        threadId: thread?.id ?? null,
      };
      if (!isVisible || !thread) return false;

      const marker = `${thread.id}:${thread.latestAttentionAt}`;
      const isOpenedThread = before === null || before.threadId !== thread.id;
      const hasNewAttention =
        before?.threadId === thread.id &&
        before.latestAttentionAt !== thread.latestAttentionAt;
      if (isOpenedThread || hasNewAttention) suppressedManualUnreadKeys.clear();

      if (threadIsRead) {
        failedKeys.delete(marker);
        pendingKeys.delete(marker);
        suppressedManualUnreadKeys.delete(marker);
        return false;
      }

      const becameVisible =
        before?.threadId === thread.id && before.isVisible === false;
      const isRetry = failedKeys.has(marker);
      const becameManuallyUnread =
        before?.threadId === thread.id &&
        before.latestAttentionAt === thread.latestAttentionAt &&
        before.isVisible &&
        before.isRead === true &&
        !isRetry;
      if (becameManuallyUnread) suppressedManualUnreadKeys.add(marker);
      if (
        suppressedManualUnreadKeys.has(marker) &&
        !isOpenedThread &&
        !hasNewAttention
      ) {
        return false;
      }
      if (!isOpenedThread && !hasNewAttention && !becameVisible && !isRetry) {
        return false;
      }
      if (pendingKeys.has(marker)) return false;

      failedKeys.delete(marker);
      pendingKeys.add(marker);
      markRead(thread.id, {
        onError: () => {
          pendingKeys.delete(marker);
          failedKeys.add(marker);
        },
        onSettled: () => {
          pendingKeys.delete(marker);
        },
      });
      return true;
    },
  };
}
