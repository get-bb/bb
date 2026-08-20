// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  isRuntimeBusyThread,
  hasActiveWorkflowActivity,
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActivePlanModeActivity,
  hasActiveGoalActivity,
  getThreadListIndicatorLabel,
  hasThreadListWorkingActivity,
  resolveThreadListIndicator,
  NO_COLLAPSED_CHILD_ACTIVITY,
  getCollapsedChildActivity,
  isUnreadDoneThread,
} from "@bb/client-core";
export type {
  ThreadListIndicatorState,
  ThreadListIndicatorKind,
  CollapsedChildActivity,
} from "@bb/client-core";
