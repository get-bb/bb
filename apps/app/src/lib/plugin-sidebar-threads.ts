import type { ThreadListEntry } from "@bb/domain";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  getThreadListIndicatorLabel,
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import { isThreadRead } from "@bb/client-core";

export function toPluginSidebarThread(
  entry: ThreadListEntry,
  hostNamesById: ReadonlyMap<string, string> = new Map(),
): PluginSidebarThread {
  const indicator = resolveThreadListIndicator(
    threadListIndicatorStateForThread(entry, false),
  );

  return {
    id: entry.id,
    projectId: entry.projectId,
    title: entry.title,
    titleFallback: entry.titleFallback,
    parentThreadId: entry.parentThreadId,
    lifecycleOwnerThreadId: entry.lifecycleOwnerThreadId,
    sourceThreadId: entry.sourceThreadId,
    sectionId: entry.sectionId,
    originKind: entry.originKind,
    originPluginId: entry.originPluginId,
    providerId: entry.providerId,
    status: entry.status,
    runtimeStatus: entry.runtime.displayStatus,
    queuedWork: entry.queuedWork,
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
    isUnread: !isThreadRead(entry),
    isPinned: entry.pinnedAt !== null,
    pinSortKey: entry.pinSortKey,
    isArchived: entry.archivedAt !== null,
    isHidden: entry.visibility === "hidden",
    environment:
      entry.environmentId === null
        ? null
        : {
            id: entry.environmentId,
            name: entry.environmentName,
            branchName: entry.environmentBranchName,
            path: entry.environmentPath,
            isWorktree: entry.environmentIsWorktree,
            providerId: entry.environmentProviderId,
            workspaceDisplayKind: entry.environmentWorkspaceDisplayKind,
          },
    host:
      entry.environmentHostId === null
        ? null
        : {
            id: entry.environmentHostId,
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
