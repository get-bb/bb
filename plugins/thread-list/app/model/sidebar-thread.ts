import type { ThreadListEntry } from "@bb/domain";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type SidebarThread = ThreadListEntry & {
  href: string;
  displayTitle: string;
};

const entriesByDto = new WeakMap<PluginSidebarThread, SidebarThread>();

export function toSidebarThread(thread: PluginSidebarThread): SidebarThread {
  const cached = entriesByDto.get(thread);
  if (cached !== undefined) return cached;
  const environment = thread.environment;
  const entry: SidebarThread = {
    id: thread.id,
    projectId: thread.projectId,
    environmentId: environment?.id ?? null,
    providerId: thread.providerId,
    title: thread.title,
    titleFallback: thread.titleFallback,
    sectionId: thread.sectionId,
    status: thread.status,
    parentThreadId: thread.parentThreadId,
    lifecycleOwnerThreadId: thread.lifecycleOwnerThreadId,
    sourceThreadId: thread.sourceThreadId,
    originKind: thread.originKind,
    originPluginId: thread.originPluginId,
    visibility: thread.isHidden ? "hidden" : "visible",
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    deletedAt: null,
    lastReadAt: thread.lastReadAt,
    latestAttentionAt: thread.latestAttentionAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    runtime: {
      displayStatus: thread.runtimeStatus,
      hostReconnectGraceExpiresAt: null,
    },
    activity: {
      activeWorkflowCount: thread.activity.workflows,
      activeBackgroundAgentCount: thread.activity.backgroundAgents,
      activeBackgroundCommandCount: thread.activity.backgroundCommands,
      activePlanModeCount: thread.activity.planMode,
      activeGoalCount: thread.activity.goals,
    },
    queuedWork: thread.queuedWork,
    pinSortKey: thread.pinSortKey,
    hasPendingInteraction: thread.hasPendingInteraction,
    environmentHostId: thread.host?.id ?? null,
    environmentName: environment?.name ?? null,
    environmentBranchName: environment?.branchName ?? null,
    environmentPath: environment?.path ?? null,
    environmentProviderId: environment?.providerId ?? null,
    environmentIsWorktree: environment?.isWorktree ?? null,
    environmentWorkspaceDisplayKind:
      environment?.workspaceDisplayKind ?? "other",
    href: thread.href,
    displayTitle: thread.displayTitle,
  };
  entriesByDto.set(thread, entry);
  return entry;
}
