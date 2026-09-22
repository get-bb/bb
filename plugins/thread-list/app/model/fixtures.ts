import type { ThreadListEntry } from "@bb/domain";
import { isThreadRead } from "@bb/client-core";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { getThreadDisplayTitle } from "./sidebar-thread.js";
import type { SidebarProject } from "./use-sidebar-data.js";

export function makeSidebarThread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  const id = overrides.id ?? "thr_test";
  const projectId = overrides.projectId ?? "proj_test";
  return {
    id,
    projectId,
    title: "Thread",
    titleFallback: "Thread",
    displayTitle: overrides.title ?? "Thread",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "provider-test",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/${projectId}/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 0,
    latestAttentionAt: 1,
    ...overrides,
  };
}

export function toPluginSidebarThread(
  entry: ThreadListEntry,
  host: { id: string; name: string } | null = entry.environmentHostId === null
    ? null
    : { id: entry.environmentHostId, name: entry.environmentHostId },
): PluginSidebarThread {
  return {
    id: entry.id,
    projectId: entry.projectId,
    title: entry.title,
    titleFallback: entry.titleFallback,
    displayTitle: getThreadDisplayTitle(entry),
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
    indicator: "none",
    indicatorLabel: null,
    isUnread: !isThreadRead(entry),
    isPinned: entry.pinnedAt !== null,
    pinnedAt: entry.pinnedAt,
    pinSortKey: entry.pinSortKey,
    isArchived: entry.archivedAt !== null,
    archivedAt: entry.archivedAt,
    href: `/projects/${entry.projectId}/threads/${entry.id}`,
    isHidden: entry.visibility === "hidden",
    environment:
      entry.environmentId === null
        ? null
        : {
            id: entry.environmentId,
            name: entry.environmentName,
            branchName: entry.environmentBranchName,
            path: entry.environmentPath,
            providerId: entry.environmentProviderId,
            isWorktree: entry.environmentIsWorktree,
            workspaceDisplayKind: entry.environmentWorkspaceDisplayKind,
          },
    host,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastReadAt: entry.lastReadAt,
    latestAttentionAt: entry.latestAttentionAt,
  };
}

export function sdkResult<T>(value: T): () => Promise<never> {
  return async () => value as never;
}

export function makePluginProject(
  overrides: Partial<PluginSidebarProject> = {},
): PluginSidebarProject {
  const id = overrides.id ?? "proj_test";
  return {
    id,
    name: "Test project",
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/settings/projects/${id}`,
    ...overrides,
  };
}

export function makeSidebarProject(
  overrides: Partial<SidebarProject> = {},
): SidebarProject {
  return { ...makePluginProject(overrides), threads: [], ...overrides };
}
