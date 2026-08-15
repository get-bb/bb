import type { ThreadListEntry } from "@bb/domain";

export function makeThreadListEntry(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  const base: ThreadListEntry = {
    id: "thr_sender",
    projectId: "proj_test",
    environmentId: null,
    providerId: "codex",
    title: "Sender thread",
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 100,
    latestAttentionAt: 100,
    createdAt: 0,
    updatedAt: 100,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
  };
  return { ...base, ...overrides };
}
