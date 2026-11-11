import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export function testThread(
  id: string,
  options: {
    environmentId?: string | null;
    projectId?: string;
    branchName?: string | null;
    name?: string | null;
    path?: string | null;
    createdAt?: number;
    parentThreadId?: string | null;
    isHidden?: boolean;
    isArchived?: boolean;
  } = {},
): PluginSidebarThread {
  const environmentId =
    options.environmentId === undefined ? "env-a" : options.environmentId;
  return {
    id,
    projectId: options.projectId ?? "p1",
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: options.parentThreadId ?? null,
    lifecycleOwnerThreadId: null,
    parentNotifications: "auto",
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
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: options.isArchived ?? false,
    archivedAt: options.isArchived ? 1 : null,
    href: `/threads/${id}`,
    isHidden: options.isHidden ?? false,
    environment:
      environmentId === null
        ? null
        : {
            id: environmentId,
            name: options.name ?? null,
            branchName: options.branchName ?? null,
            path: options.path ?? null,
            isWorktree: true,
            providerId: "git-worktree",
            workspaceDisplayKind: null,
          },
    host: null,
    createdAt: options.createdAt ?? 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
  };
}
