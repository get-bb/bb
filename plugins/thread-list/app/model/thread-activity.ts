import type {
  PluginSidebarThread,
  PluginSidebarThreadIndicator,
} from "@get-bb/plugin-sdk/app";

type ThreadStatusShape = Pick<
  PluginSidebarThread,
  "status" | "isUnread" | "parentThreadId"
>;
type ThreadRuntimeShape = Pick<PluginSidebarThread, "runtimeStatus">;
type ThreadActivityStateShape = Pick<PluginSidebarThread, "activity">;

const RUNNING_RUNTIME_STATUSES: Record<
  PluginSidebarThread["runtimeStatus"],
  boolean
> = {
  active: true,
  provisioning: true,
  starting: true,
  stopping: true,
  error: false,
  idle: false,
  pending: false,
  "waiting-for-host": false,
};

const DONE_THREAD_STATUSES: Record<PluginSidebarThread["status"], boolean> = {
  error: true,
  idle: true,
  active: false,
  starting: false,
  stopping: false,
  pending: false,
};

export function isRuntimeBusyThread(thread: ThreadRuntimeShape): boolean {
  return RUNNING_RUNTIME_STATUSES[thread.runtimeStatus] ?? false;
}

function hasActiveWorkflowActivity(thread: ThreadActivityStateShape): boolean {
  return thread.activity.workflows > 0;
}

function hasActiveBackgroundAgentActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.backgroundAgents > 0;
}

function hasActiveBackgroundCommandActivity(
  thread: ThreadActivityStateShape,
): boolean {
  return thread.activity.backgroundCommands > 0;
}

function hasActivePlanModeActivity(thread: ThreadActivityStateShape): boolean {
  return thread.activity.planMode > 0;
}

function hasActiveGoalActivity(thread: ThreadActivityStateShape): boolean {
  return thread.activity.goals > 0;
}

function isBusyThread(
  thread: ThreadRuntimeShape & ThreadActivityStateShape,
): boolean {
  return (
    isRuntimeBusyThread(thread) ||
    hasActiveWorkflowActivity(thread) ||
    hasActiveBackgroundAgentActivity(thread) ||
    hasActiveBackgroundCommandActivity(thread) ||
    hasActivePlanModeActivity(thread) ||
    hasActiveGoalActivity(thread)
  );
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
  queuedWork: PluginSidebarThread["queuedWork"];
}

export type ThreadListIndicatorKind = PluginSidebarThreadIndicator;

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
  "queued-failed": "Queued message failed to send",
  "queued-waiting": "Thread has a message waiting to send",
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

export function threadListIndicatorStateForThread(
  thread: ThreadStatusShape &
    ThreadRuntimeShape &
    ThreadActivityStateShape &
    Pick<PluginSidebarThread, "hasPendingInteraction" | "queuedWork">,
  hasUnsubmittedDraft: boolean,
): ThreadListIndicatorState {
  const unreadDone = isUnreadDoneThread(thread);
  return {
    hasPendingInteraction: thread.hasPendingInteraction,
    hasUnsubmittedDraft,
    hasUnreadError: unreadDone && thread.status === "error",
    hasUnreadSuccess: unreadDone && thread.status !== "error",
    isBackgroundAgentActive: hasActiveBackgroundAgentActivity(thread),
    isBackgroundCommandActive: hasActiveBackgroundCommandActivity(thread),
    isGoalActive: hasActiveGoalActivity(thread),
    queuedWork: thread.queuedWork,
    isPlanModeActive: hasActivePlanModeActivity(thread),
    isRuntimeActive: isRuntimeBusyThread(thread),
    isWorkflowActive: hasActiveWorkflowActivity(thread),
  };
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
  if (state.queuedWork === "failed") return "queued-failed";
  if (state.hasUnreadSuccess) return "unread-success";
  if (state.queuedWork === "waiting") return "queued-waiting";
  if (state.hasUnsubmittedDraft) return "draft";
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
  Pick<PluginSidebarThread, "id" | "activity" | "hasPendingInteraction">;

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
    if (isBusyThread(thread)) working = true;
    if (isRuntimeBusyThread(thread)) runtimeWorking = true;
    if (hasActiveWorkflowActivity(thread)) workflow = true;
    if (hasActiveBackgroundAgentActivity(thread)) backgroundAgent = true;
    if (hasActiveBackgroundCommandActivity(thread)) backgroundCommand = true;
    if (hasActivePlanModeActivity(thread)) planMode = true;
    if (hasActiveGoalActivity(thread)) goal = true;
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
  return (DONE_THREAD_STATUSES[thread.status] ?? false) && thread.isUnread;
}
