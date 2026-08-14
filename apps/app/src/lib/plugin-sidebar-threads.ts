import type { ThreadListEntry } from "@bb/domain";
import type {
  PluginSidebarThread,
  PluginSidebarThreadIndicator,
} from "@get-bb/plugin-sdk";
import {
  getThreadListIndicatorLabel,
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
  isUnreadDoneThread,
  resolveThreadListIndicator,
} from "./thread-activity";
import { isThreadRead } from "./thread-read-state";

/**
 * The ONE place a host `ThreadListEntry` becomes the plugin-facing
 * `PluginSidebarThread`. Two mappers would drift; this one is unit-tested
 * against the host's own indicator precedence.
 *
 * `hasUnsubmittedDraft` is deliberately not part of the mapping: an
 * unsubmitted composer draft is per-client, per-composer state that the
 * built-in row reads with its own hook, and one array-wide mapper cannot call
 * a hook per thread.
 *
 * So `indicator` never reports "draft" or "working-draft". The one visible
 * consequence: an idle, unread, successful thread that also holds a draft
 * reads as "unread-success" here where the built-in row paints "draft". Every
 * other state is unaffected, because a draft outranks nothing else.
 */
export function toPluginSidebarThread(
  entry: ThreadListEntry,
  /**
   * Machine names by host id. The plugin cannot resolve a bare host id, so
   * the host resolves it here and hands over a name the row can print.
   */
  hostNamesById: ReadonlyMap<string, string> = new Map(),
): PluginSidebarThread {
  const isUnreadDone = isUnreadDoneThread(entry);
  const hasUnreadError = isUnreadDone && entry.status === "error";
  const indicator: PluginSidebarThreadIndicator = resolveThreadListIndicator({
    hasPendingInteraction: entry.hasPendingInteraction,
    hasUnsubmittedDraft: false,
    hasUnreadError,
    hasUnreadSuccess: isUnreadDone && !hasUnreadError,
    isBackgroundAgentActive: hasActiveBackgroundAgentActivity(entry),
    isBackgroundCommandActive: hasActiveBackgroundCommandActivity(entry),
    isGoalActive: hasActiveGoalActivity(entry),
    isPlanModeActive: hasActivePlanModeActivity(entry),
    isRuntimeActive: isRuntimeBusyThread(entry),
    isWorkflowActive: hasActiveWorkflowActivity(entry),
  });

  return {
    id: entry.id,
    projectId: entry.projectId,
    title: entry.title,
    titleFallback: entry.titleFallback,
    parentThreadId: entry.parentThreadId,
    sectionId: entry.sectionId,
    originKind: entry.originKind,
    originPluginId: entry.originPluginId,
    providerId: entry.providerId,
    hasPendingInteraction: entry.hasPendingInteraction,
    activity: {
      workflows: entry.activity.activeWorkflowCount,
      backgroundAgents: entry.activity.activeBackgroundAgentCount,
      backgroundCommands: entry.activity.activeBackgroundCommandCount,
      planMode: entry.activity.activePlanModeCount,
      goals: entry.activity.activeGoalCount,
    },
    indicator,
    indicatorLabel: getThreadListIndicatorLabel(indicator),
    // Plain read state, not `isUnreadDoneThread`: a plugin list may show
    // child threads and running threads, both of which that helper excludes
    // by design (it answers "should this row show a done dot").
    isUnread: !isThreadRead(entry),
    isPinned: entry.pinnedAt !== null,
    isArchived: entry.archivedAt !== null,
    environment:
      entry.environmentId === null
        ? null
        : {
            id: entry.environmentId,
            name: entry.environmentName,
            branchName: entry.environmentBranchName,
            workspaceDisplayKind: entry.environmentWorkspaceDisplayKind,
          },
    host:
      entry.environmentHostId === null
        ? null
        : {
            id: entry.environmentHostId,
            // An unknown host still gets a row: fall back to the id rather
            // than dropping the machine entirely.
            name:
              hostNamesById.get(entry.environmentHostId) ??
              entry.environmentHostId,
          },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastReadAt: entry.lastReadAt,
    latestAttentionAt: entry.latestAttentionAt,
  };
}
