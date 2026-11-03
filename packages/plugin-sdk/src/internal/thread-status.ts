import type {
  PluginSidebarThread,
  PluginSidebarThreadIndicator,
  PluginSidebarThreadRowStatus,
  PluginThreadStatus,
  PluginThreadStatusInput,
  PluginThreadStatusThread,
} from "../app-contract.js";

type IndicatorLabelKind = Exclude<PluginSidebarThreadIndicator, "none">;

const INDICATOR_LABELS: Record<IndicatorLabelKind, string> = {
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

const INDICATORS_OVER_ROW_STATUS: ReadonlySet<PluginSidebarThreadIndicator> =
  new Set(["runtime", "unread-error", "waiting-for-input"]);

interface IndicatorFlags {
  pending: boolean;
  unreadError: boolean;
  unreadSuccess: boolean;
  runtime: boolean;
  workflow: boolean;
  backgroundAgent: boolean;
  backgroundCommand: boolean;
  planMode: boolean;
  goal: boolean;
}

export function threadIndicatorLabel(
  indicator: PluginSidebarThreadIndicator,
): string | null {
  return indicator === "none" ? null : INDICATOR_LABELS[indicator];
}

export function visibleThreadRowStatus(
  indicator: PluginSidebarThreadIndicator,
  rowStatus: PluginSidebarThreadRowStatus | null,
): PluginSidebarThreadRowStatus | null {
  return INDICATORS_OVER_ROW_STATUS.has(indicator) ? null : rowStatus;
}

function isUnreadDoneThread(thread: PluginThreadStatusThread): boolean {
  return (
    thread.parentThreadId === null &&
    thread.isUnread &&
    DONE_THREAD_STATUSES[thread.status]
  );
}

function addThreadFlags(
  flags: IndicatorFlags,
  thread: PluginThreadStatusThread,
): void {
  const unreadDone = isUnreadDoneThread(thread);
  flags.pending ||= thread.hasPendingInteraction;
  flags.unreadError ||= unreadDone && thread.status === "error";
  flags.unreadSuccess ||= unreadDone && thread.status !== "error";
  flags.runtime ||= RUNNING_RUNTIME_STATUSES[thread.runtimeStatus];
  flags.workflow ||= thread.activity.workflows > 0;
  flags.backgroundAgent ||= thread.activity.backgroundAgents > 0;
  flags.backgroundCommand ||= thread.activity.backgroundCommands > 0;
  flags.planMode ||= thread.activity.planMode > 0;
  flags.goal ||= thread.activity.goals > 0;
}

function resolveIndicator(
  flags: IndicatorFlags,
  queuedWork: PluginThreadStatusThread["queuedWork"],
  hasUnsubmittedDraft: boolean,
  isWorking: boolean,
): PluginSidebarThreadIndicator {
  if (flags.unreadError) return "unread-error";
  if (flags.pending) return "waiting-for-input";
  if (hasUnsubmittedDraft && isWorking) return "working-draft";
  if (flags.planMode) return "plan-mode";
  if (flags.goal) return "goal";
  if (flags.runtime) return "runtime";
  if (flags.workflow) return "workflow";
  if (queuedWork === "failed") return "queued-failed";
  if (flags.unreadSuccess) return "unread-success";
  if (flags.backgroundAgent) return "background-agent";
  if (flags.backgroundCommand) return "background-command";
  if (queuedWork === "waiting") return "queued-waiting";
  if (hasUnsubmittedDraft) return "draft";
  return "none";
}

export function experimental_resolveThreadStatus({
  thread,
  hiddenThreads,
  hasUnsubmittedDraft,
  rowStatus,
}: PluginThreadStatusInput): PluginThreadStatus {
  const flags: IndicatorFlags = {
    pending: false,
    unreadError: false,
    unreadSuccess: false,
    runtime: false,
    workflow: false,
    backgroundAgent: false,
    backgroundCommand: false,
    planMode: false,
    goal: false,
  };
  if (thread !== null) addThreadFlags(flags, thread);
  for (const hiddenThread of hiddenThreads) addThreadFlags(flags, hiddenThread);
  const isThreadWorking =
    flags.runtime ||
    flags.workflow ||
    flags.backgroundAgent ||
    flags.backgroundCommand ||
    flags.planMode ||
    flags.goal;
  const indicator = resolveIndicator(
    flags,
    thread?.queuedWork ?? "none",
    hasUnsubmittedDraft,
    isThreadWorking,
  );
  const shownRowStatus = visibleThreadRowStatus(indicator, rowStatus);
  return {
    indicator,
    rowStatus: shownRowStatus,
    label: shownRowStatus?.label ?? threadIndicatorLabel(indicator),
    isWorking: isThreadWorking || rowStatus?.tone === "running",
  };
}
