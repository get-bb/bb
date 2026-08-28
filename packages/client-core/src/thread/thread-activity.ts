import { assertNever } from "@bb/core-ui";
import type { Thread, ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import { isRunningThreadRuntimeDisplayStatus } from "../timeline/thread-runtime-status.js";
import { isThreadRead } from "./thread-read-state.js";

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

export function hasActiveBackgroundAgentActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.activeBackgroundAgentCount > 0;
}

export function hasActiveBackgroundCommandActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.activeBackgroundCommandCount > 0;
}

export function hasActivePlanModeActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.activePlanModeCount > 0;
}

export function hasActiveGoalActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.activeGoalCount > 0;
}

export interface ThreadListIndicatorState {
  hasPendingInteraction: boolean;
  hasUnsubmittedDraft: boolean;
  hasUnreadError: boolean;
  hasUnreadSuccess: boolean;
  isBackgroundAgentActive: boolean;
  isBackgroundCommandActive: boolean;
  isGoalActive: boolean;
  isPlanModeActive: boolean;
  isRuntimeActive: boolean;
  isWorkflowActive: boolean;
}

export type ThreadListIndicatorKind =
  | "unread-error"
  | "waiting-for-input"
  | "working-draft"
  | "workflow"
  | "background-agent"
  | "background-command"
  | "plan-mode"
  | "goal"
  | "runtime"
  | "draft"
  | "unread-success"
  | "none";

const THREAD_LIST_INDICATOR_LABELS: Record<
  Exclude<ThreadListIndicatorKind, "none">,
  string
> = {
  "unread-error": "Unread thread failed",
  "waiting-for-input": "Thread needs user input",
  "working-draft": "Thread working with unsubmitted draft",
  workflow: "Workflow running",
  "background-agent": "Background agent running",
  "background-command": "Background command running",
  "plan-mode": "Plan mode active",
  goal: "Goal active",
  runtime: "Thread working",
  draft: "Thread has unsubmitted draft",
  "unread-success": "Unread thread succeeded",
};

export function getThreadListIndicatorLabel(
  kind: ThreadListIndicatorKind,
): string | null {
  return kind === "none" ? null : THREAD_LIST_INDICATOR_LABELS[kind];
}

export function hasThreadListWorkingActivity(
  state: ThreadListIndicatorState,
  hasRunningPluginStatus = false,
): boolean {
  return (
    state.isRuntimeActive ||
    state.isWorkflowActive ||
    state.isBackgroundAgentActive ||
    state.isBackgroundCommandActive ||
    state.isPlanModeActive ||
    state.isGoalActive ||
    hasRunningPluginStatus
  );
}

export function resolveThreadListIndicator(
  state: ThreadListIndicatorState,
): ThreadListIndicatorKind {
  if (state.hasUnreadError) return "unread-error";
  if (state.hasPendingInteraction) return "waiting-for-input";

  const hasActiveWork = hasThreadListWorkingActivity(state);
  if (state.hasUnsubmittedDraft && hasActiveWork) return "working-draft";
  if (state.isPlanModeActive) return "plan-mode";
  if (state.isGoalActive) return "goal";
  if (state.isRuntimeActive) return "runtime";
  if (state.isWorkflowActive) return "workflow";
  if (state.isBackgroundAgentActive) return "background-agent";
  if (state.isBackgroundCommandActive) return "background-command";
  if (state.hasUnsubmittedDraft) return "draft";
  if (state.hasUnreadSuccess) return "unread-success";
  return "none";
}

export interface CollapsedChildActivity {
  pending: boolean;
  working: boolean;
  hasUnsubmittedDraft: boolean;
  runtimeWorking: boolean;
  workflow: boolean;
  backgroundAgent: boolean;
  backgroundCommand: boolean;
  planMode: boolean;
  goal: boolean;
  unread: boolean;
  unreadError: boolean;
}

export const NO_COLLAPSED_CHILD_ACTIVITY: CollapsedChildActivity = {
  pending: false,
  working: false,
  hasUnsubmittedDraft: false,
  runtimeWorking: false,
  workflow: false,
  backgroundAgent: false,
  backgroundCommand: false,
  planMode: false,
  goal: false,
  unread: false,
  unreadError: false,
};

type ThreadActivityShape = ThreadStatusShape &
  ThreadRuntimeShape &
  Pick<ThreadListEntry, "id" | "activity" | "hasPendingInteraction">;

const EMPTY_DRAFT_THREAD_IDS: ReadonlySet<string> = new Set();

export function getCollapsedChildActivity(
  threads: readonly ThreadActivityShape[],
  draftThreadIds: ReadonlySet<string> = EMPTY_DRAFT_THREAD_IDS,
): CollapsedChildActivity {
  let pending = false;
  let working = false;
  let hasUnsubmittedDraft = false;
  let runtimeWorking = false;
  let workflow = false;
  let backgroundAgent = false;
  let backgroundCommand = false;
  let planMode = false;
  let goal = false;
  let unread = false;
  let unreadError = false;
  for (const thread of threads) {
    if (draftThreadIds.has(thread.id)) {
      hasUnsubmittedDraft = true;
    }
    const childUnreadDone = isUnreadDoneThread(thread);
    if (childUnreadDone && thread.status === "error") {
      unreadError = true;
    } else if (childUnreadDone) {
      unread = true;
    }

    if (thread.hasPendingInteraction) {
      pending = true;
    }
    const childRuntimeWorking = isRuntimeBusyThread(thread);
    const childWorkflowActive = hasActiveWorkflowActivity(thread);
    const childBackgroundAgentActive = hasActiveBackgroundAgentActivity(thread);
    const childBackgroundCommandActive =
      hasActiveBackgroundCommandActivity(thread);
    const childPlanModeActive = hasActivePlanModeActivity(thread);
    const childGoalActive = hasActiveGoalActivity(thread);
    if (childRuntimeWorking) {
      runtimeWorking = true;
      working = true;
    }
    if (childWorkflowActive) {
      workflow = true;
      working = true;
    }
    if (childBackgroundAgentActive) {
      backgroundAgent = true;
      working = true;
    }
    if (childBackgroundCommandActive) {
      backgroundCommand = true;
      working = true;
    }
    if (childPlanModeActive) {
      planMode = true;
      working = true;
    }
    if (childGoalActive) {
      goal = true;
      working = true;
    }
  }
  return {
    pending,
    working,
    hasUnsubmittedDraft,
    runtimeWorking,
    workflow,
    backgroundAgent,
    backgroundCommand,
    planMode,
    goal,
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
