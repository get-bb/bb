import type { ThreadListEntry } from "@bb/domain";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type SidebarThread = ThreadListEntry & {
  href: string;
  displayTitle: string;
};

const entriesByDto = new WeakMap<PluginSidebarThread, SidebarThread>();
const entriesByListEntry = new WeakMap<ThreadListEntry, SidebarThread>();

export function getThreadDisplayTitle(
  thread: Pick<ThreadListEntry, "id" | "title" | "titleFallback">,
): string {
  if (thread.title && thread.title.trim().length > 0) return thread.title;
  if (thread.titleFallback && thread.titleFallback.trim().length > 0) {
    return thread.titleFallback;
  }
  return `Thread ${thread.id.slice(0, 8)}`;
}

function isSidebarThread(thread: ThreadListEntry): thread is SidebarThread {
  return (
    "href" in thread &&
    typeof thread.href === "string" &&
    "displayTitle" in thread &&
    typeof thread.displayTitle === "string"
  );
}

export function asSidebarThread(thread: ThreadListEntry): SidebarThread {
  if (isSidebarThread(thread)) return thread;
  const cached = entriesByListEntry.get(thread);
  if (cached !== undefined) return cached;
  const entry: SidebarThread = {
    ...thread,
    href: `/projects/${thread.projectId}/threads/${thread.id}`,
    displayTitle: getThreadDisplayTitle(thread),
  };
  entriesByListEntry.set(thread, entry);
  return entry;
}

export function getSidebarThreadDisplayTitle(thread: ThreadListEntry): string {
  return asSidebarThread(thread).displayTitle;
}

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
