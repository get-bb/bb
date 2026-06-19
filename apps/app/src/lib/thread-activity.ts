import { assertNever } from "@bb/core-ui";
import type { Thread, ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import { isRunningThreadRuntimeDisplayStatus } from "@/components/thread/timeline";
import { isThreadRead } from "@/lib/thread-read-state";

type ThreadStatusShape = Pick<
  Thread,
  "status" | "lastReadAt" | "latestAttentionAt" | "parentThreadId"
>;

type ThreadRuntimeShape = Pick<ThreadWithRuntime, "runtime">;
type ThreadActivityStateShape = Pick<ThreadListEntry, "activity">;

export function isRuntimeBusyThread(thread: ThreadRuntimeShape): boolean {
  return isRunningThreadRuntimeDisplayStatus(thread.runtime.displayStatus);
}

export function hasActiveWorkflowActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.activeWorkflowCount > 0;
}

export function hasActiveBackgroundActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return (
    thread.activity.activeWorkflowCount > 0 ||
    thread.activity.activeBackgroundSubagentCount > 0
  );
}

export function isBusyThread(
  thread: ThreadRuntimeShape & ThreadActivityStateShape,
): boolean {
  return isRuntimeBusyThread(thread) || hasActiveBackgroundActivity(thread);
}

/**
 * The signals a collapsed parent row surfaces on behalf of its hidden children.
 * A collapsed row renders these through its single trailing status glyph, using
 * the same priority as a leaf row: failed unread work is loudest, then pending
 * user input, then unread success, then working. Expanded rows show their own
 * status, since the children are then visible with their own glyphs.
 */
export interface CollapsedChildActivity {
  /** At least one child is blocked on the user (needs input). */
  pending: boolean;
  /** At least one child is actively working, including background work. */
  working: boolean;
  /** At least one child is actively running a foreground/runtime turn. */
  runtimeWorking: boolean;
  /** At least one idle child has non-workflow background work running. */
  backgroundWorking: boolean;
  /** At least one idle child has a provider workflow still running. */
  workflow: boolean;
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
  runtimeWorking: false,
  backgroundWorking: false,
  workflow: false,
  unread: false,
  unreadError: false,
};

type ThreadActivityShape = ThreadStatusShape &
  ThreadRuntimeShape &
  Pick<ThreadListEntry, "activity" | "hasPendingInteraction">;

/** Rolls a child thread list up to the set of activity signals present in it. */
export function getCollapsedChildActivity(
  threads: readonly ThreadActivityShape[],
): CollapsedChildActivity {
  let pending = false;
  let working = false;
  let runtimeWorking = false;
  let backgroundWorking = false;
  let workflow = false;
  let unread = false;
  let unreadError = false;
  for (const thread of threads) {
    if (thread.hasPendingInteraction) {
      // Mirror leaf rows: a blocked thread reads as pending, not also working.
      pending = true;
      continue;
    }
    if (isRuntimeBusyThread(thread)) {
      runtimeWorking = true;
      working = true;
    } else if (hasActiveWorkflowActivity(thread)) {
      workflow = true;
      working = true;
    } else if (hasActiveBackgroundActivity(thread)) {
      backgroundWorking = true;
      working = true;
    } else if (isUnreadDoneThread(thread)) {
      unread = true;
      if (thread.status === "error") {
        unreadError = true;
      }
    }
  }
  return {
    pending,
    working,
    runtimeWorking,
    backgroundWorking,
    workflow,
    unread,
    unreadError,
  };
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
