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

export function hasActiveBackgroundCommandActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.activeBackgroundCommandCount > 0;
}

export function isBusyThread(
  thread: ThreadRuntimeShape & ThreadActivityStateShape,
): boolean {
  return (
    isRuntimeBusyThread(thread) ||
    hasActiveWorkflowActivity(thread) ||
    hasActiveBackgroundCommandActivity(thread)
  );
}

/**
 * The signals a collapsed parent row surfaces on behalf of its hidden children.
 * A collapsed row renders these through its single trailing status glyph, using
 * the same priority as a leaf row: failed unread work is loudest, then pending
 * user input, then background commands, then workflow work, then unread
 * success, then generic runtime work. Expanded rows show their own status,
 * since the children are then visible with their own glyphs. Background
 * commands and workflow work are tracked separately from runtime work so the
 * sidebar can use the same task-specific signals as the prompt banner instead
 * of collapsing them into a generic spinner.
 */
export interface CollapsedChildActivity {
  /** At least one child is blocked on the user (needs input). */
  pending: boolean;
  /** At least one child is actively working, including workflow work. */
  working: boolean;
  /** At least one child is actively running a foreground/runtime turn. */
  runtimeWorking: boolean;
  /** At least one child has a background shell command still running. */
  backgroundCommand: boolean;
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
  backgroundCommand: false,
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
  let backgroundCommand = false;
  let workflow = false;
  let unread = false;
  let unreadError = false;
  for (const thread of threads) {
    if (thread.hasPendingInteraction) {
      // Mirror leaf rows: a blocked thread reads as pending, not also working.
      pending = true;
      continue;
    }
    const childRuntimeWorking = isRuntimeBusyThread(thread);
    const childBackgroundCommandActive =
      hasActiveBackgroundCommandActivity(thread);
    const childWorkflowActive = hasActiveWorkflowActivity(thread);
    if (childRuntimeWorking) {
      runtimeWorking = true;
      working = true;
    }
    if (childBackgroundCommandActive) {
      backgroundCommand = true;
      working = true;
    }
    if (childWorkflowActive) {
      workflow = true;
      working = true;
    }
    if (
      !childRuntimeWorking &&
      !childBackgroundCommandActive &&
      !childWorkflowActive &&
      isUnreadDoneThread(thread)
    ) {
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
    backgroundCommand,
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
