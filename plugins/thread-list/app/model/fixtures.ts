import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

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
    providerId: "codex",
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
