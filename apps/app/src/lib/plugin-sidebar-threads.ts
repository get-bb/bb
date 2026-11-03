import type { ThreadListEntry } from "@bb/domain";
import type {
  PluginSidebarThread,
  PluginThreadStatusThread,
} from "@get-bb/plugin-sdk";
import { experimental_resolveThreadStatus } from "@get-bb/plugin-sdk/internal/thread-status";
import { isThreadRead } from "@bb/client-core";
import {
  EMPTY_TITLE_MENTION_RESOURCES,
  resolveThreadTitleDisplayText,
  type ThreadTitleMentionResources,
} from "@/components/thread/ThreadTitleMentions";
import { getThreadDisplayTitle } from "./thread-title";
import { getThreadRoutePath } from "./route-paths";

export function toThreadStatusThread(
  entry: ThreadListEntry,
): PluginThreadStatusThread {
  return {
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
    isUnread: !isThreadRead(entry),
    parentThreadId: entry.parentThreadId,
  };
}

export function toPluginSidebarThread(
  entry: ThreadListEntry,
  hostNamesById: ReadonlyMap<string, string> = new Map(),
  titleResources: ThreadTitleMentionResources = EMPTY_TITLE_MENTION_RESOURCES,
): PluginSidebarThread {
  const statusThread = toThreadStatusThread(entry);
  const { indicator, label } = experimental_resolveThreadStatus({
    thread: statusThread,
    hiddenThreads: [],
    hasUnsubmittedDraft: false,
    rowStatus: null,
  });

  return {
    ...statusThread,
    id: entry.id,
    projectId: entry.projectId,
    title: entry.title,
    titleFallback: entry.titleFallback,
    displayTitle: resolveThreadTitleDisplayText(
      getThreadDisplayTitle(entry),
      titleResources,
    ),
    parentNotifications: entry.parentNotifications,
    lifecycleOwnerThreadId: entry.lifecycleOwnerThreadId,
    sourceThreadId: entry.sourceThreadId,
    sectionId: entry.sectionId,
    originKind: entry.originKind,
    originPluginId: entry.originPluginId,
    providerId: entry.providerId,
    indicator,
    indicatorLabel: label,
    isPinned: entry.pinnedAt !== null,
    pinnedAt: entry.pinnedAt,
    pinSortKey: entry.pinSortKey,
    isArchived: entry.archivedAt !== null,
    archivedAt: entry.archivedAt,
    href: getThreadRoutePath({
      projectId: entry.projectId,
      threadId: entry.id,
    }),
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
