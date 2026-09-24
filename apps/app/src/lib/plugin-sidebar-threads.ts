import type { ThreadListEntry } from "@bb/domain";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  getThreadListIndicatorLabel,
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import { isThreadRead } from "@bb/client-core";
import {
  EMPTY_TITLE_MENTION_RESOURCES,
  resolveThreadTitleDisplayText,
  type ThreadTitleMentionResources,
} from "@/components/thread/ThreadTitleMentions";
import { getThreadDisplayTitle } from "./thread-title";
import { getThreadRoutePath } from "./route-paths";

export function toPluginSidebarThread(
  entry: ThreadListEntry,
  hostNamesById: ReadonlyMap<string, string> = new Map(),
  titleResources: ThreadTitleMentionResources = EMPTY_TITLE_MENTION_RESOURCES,
): PluginSidebarThread {
  const indicator = resolveThreadListIndicator(
    threadListIndicatorStateForThread(entry, false),
  );

  return {
    id: entry.id,
    projectId: entry.projectId,
    title: entry.title,
    titleFallback: entry.titleFallback,
    displayTitle: resolveThreadTitleDisplayText(
      getThreadDisplayTitle(entry),
      titleResources,
    ),
    parentThreadId: entry.parentThreadId,
    lifecycleOwnerThreadId: entry.lifecycleOwnerThreadId,
    sourceThreadId: entry.sourceThreadId,
    sectionId: entry.sectionId,
    originKind: entry.originKind,
    originPluginId: entry.originPluginId,
    providerId: entry.providerId,
    model: entry.model,
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
    pinnedAt: entry.pinnedAt,
    pinSortKey: entry.pinSortKey,
    isArchived: entry.archivedAt !== null,
    archivedAt: entry.archivedAt,
    href: getThreadRoutePath({ projectId: entry.projectId, threadId: entry.id }),
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
