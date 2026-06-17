import { assertNever } from "@bb/core-ui";
import type { Thread, ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import { isRunningThreadRuntimeDisplayStatus } from "@/components/thread/timeline";
import { isThreadRead } from "@/lib/thread-read-state";

type ThreadStatusShape = Pick<
  Thread,
  "status" | "lastReadAt" | "latestAttentionAt" | "parentThreadId"
>;

type ThreadRuntimeShape = Pick<ThreadWithRuntime, "runtime">;

export function isBusyThread(thread: ThreadRuntimeShape): boolean {
  return isRunningThreadRuntimeDisplayStatus(thread.runtime.displayStatus);
}

/**
 * The signals a collapsed parent row surfaces on behalf of its hidden children.
 * A collapsed row renders these through its single trailing status glyph, using
 * the same priority as a leaf row (pending > working > unread): a child blocked
 * on the user shows the attention dot, else a working child spins, else an
 * unread child shows the unread dot. `unreadError` only colors that final unread
 * state. Expanded rows show their own status, since the children are then
 * visible with their own glyphs.
 */
export interface CollapsedChildActivity {
  /** At least one child is blocked on the user (needs input). */
  pending: boolean;
  /** At least one child is actively working. */
  working: boolean;
  /**
   * At least one finished child is unread. Only top-level worktree children
   * qualify — `isUnreadDoneThread` is false for parented threads, so manager
   * and managed-subgroup rollups never set this.
   */
  unread: boolean;
  /** At least one unread child has reached the terminal error state. */
  unreadError: boolean;
}

export const NO_COLLAPSED_CHILD_ACTIVITY: CollapsedChildActivity = {
  pending: false,
  working: false,
  unread: false,
  unreadError: false,
};

type ThreadActivityShape = ThreadStatusShape &
  ThreadRuntimeShape &
  Pick<ThreadListEntry, "hasPendingInteraction">;

/** Rolls a child thread list up to the set of activity signals present in it. */
export function getCollapsedChildActivity(
  threads: readonly ThreadActivityShape[],
): CollapsedChildActivity {
  let pending = false;
  let working = false;
  let unread = false;
  let unreadError = false;
  for (const thread of threads) {
    if (thread.hasPendingInteraction) {
      // Mirror leaf rows: a blocked thread reads as pending, not also working.
      pending = true;
      continue;
    }
    if (isBusyThread(thread)) {
      working = true;
    } else if (isUnreadDoneThread(thread)) {
      unread = true;
      if (thread.status === "error") {
        unreadError = true;
      }
    }
  }
  return { pending, working, unread, unreadError };
}

export function isUnreadDoneThread(thread: ThreadStatusShape): boolean {
  if (thread.parentThreadId != null) {
    return false;
  }

  switch (thread.status) {
    case "error":
    case "idle":
      return !isThreadRead(thread);
    case "active":
    case "starting":
    case "stopping":
      return false;
    default:
      return assertNever(thread.status);
  }
}
