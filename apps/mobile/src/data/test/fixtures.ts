import {
  PERSONAL_PROJECT_ID,
  type ApprovalPendingInteraction,
  type ApprovalPendingInteractionPayload,
  type Host,
  type JsonValue,
  type PendingInteractionApprovalDecision,
  type PluginPendingInteraction,
  type ThreadListEntry,
  type ThreadQueuedMessage,
  type UserQuestionPendingInteraction,
  type UserQuestionPendingInteractionPayload,
} from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
  ThreadResponse,
  ThreadTimelineResponse,
  TimelineRow,
} from "@bb/server-contract";

/** Test fixtures for the data layer (never imported by app code). */

export function threadListEntry(
  overrides: Partial<ThreadListEntry> & { id: string },
): ThreadListEntry {
  return {
    projectId: "proj_1",
    environmentId: null,
    providerId: "codex",
    title: `Thread ${overrides.id}`,
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
    lastReadAt: 10,
    latestAttentionAt: 10,
    createdAt: 1,
    updatedAt: 10,
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
    ...overrides,
  };
}

export function threadResponse(
  overrides: Partial<ThreadResponse> & { id: string },
): ThreadResponse {
  const {
    activity: _activity,
    hasPendingInteraction: _pending,
    pinSortKey: _pinSortKey,
    environmentHostId: _hostId,
    environmentName: _envName,
    environmentBranchName: _branch,
    environmentWorkspaceDisplayKind: _kind,
    ...base
  } = threadListEntry({ id: overrides.id });
  return {
    ...base,
    activeBackgroundAgentCount: 0,
    canSpawnChild: true,
    ...overrides,
  };
}

export function project(
  overrides: Partial<ProjectWithThreadsResponse> & { id: string },
): ProjectWithThreadsResponse {
  return {
    kind: "standard",
    name: `Project ${overrides.id}`,
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: [],
    threads: [],
    defaultExecutionOptions: null,
    ...overrides,
  };
}

export function sidebarBootstrap(
  overrides: Partial<SidebarBootstrapResponse> = {},
): SidebarBootstrapResponse {
  return {
    sections: [],
    projects: [],
    personalProject: project({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
    }),
    ...overrides,
  };
}

export function host(overrides: Partial<Host> & { id: string }): Host {
  return {
    name: `Host ${overrides.id}`,
    type: "persistent",
    status: "connected",
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function queuedMessage(
  overrides: Partial<ThreadQueuedMessage> & { id: string },
): ThreadQueuedMessage {
  return {
    content: [{ type: "text", text: `Queued ${overrides.id}`, mentions: [] }],
    model: "fake-model",
    reasoningLevel: "medium",
    permissionMode: "auto",
    serviceTier: "default",
    groupWithNext: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function timelineResponse(
  rows: TimelineRow[],
  overrides: Partial<ThreadTimelineResponse> = {},
): ThreadTimelineResponse {
  return {
    rows,
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 50,
      returnedSegmentCount: rows.length,
      hasOlderRows: false,
      olderCursor: null,
    },
    maxSeq: rows.reduce((max, row) => Math.max(max, row.sourceSeqEnd), 0),
    ...overrides,
  };
}

export function approvalInteraction(
  overrides: Partial<ApprovalPendingInteraction> & {
    id: string;
    subject?: ApprovalPendingInteractionPayload["subject"];
    availableDecisions?: PendingInteractionApprovalDecision[];
    reason?: string | null;
  },
): ApprovalPendingInteraction {
  const {
    subject = {
      kind: "command",
      itemId: "item-1",
      command: "echo hi",
      cwd: "/repo",
      actions: [],
      sessionGrant: null,
    },
    availableDecisions = ["allow_once", "allow_for_session", "deny"],
    reason = null,
    ...rest
  } = overrides;
  return {
    threadId: "t1",
    turnId: "turn-1",
    providerId: "fake",
    providerThreadId: "pt-1",
    providerRequestId: "req-1",
    status: "pending",
    statusReason: null,
    createdAt: 100,
    resolvedAt: null,
    payload: { kind: "approval", subject, reason, availableDecisions },
    resolution: null,
    ...rest,
  };
}

export function userQuestionInteraction(
  overrides: Partial<UserQuestionPendingInteraction> & {
    id: string;
    questions?: UserQuestionPendingInteractionPayload["questions"];
  },
): UserQuestionPendingInteraction {
  const {
    questions = [
      {
        id: "q1",
        prompt: "Which color?",
        shortLabel: "Color",
        multiSelect: false,
        options: [
          { value: "red", label: "Red" },
          { value: "blue", label: "Blue" },
        ],
        allowFreeText: true,
      },
    ],
    ...rest
  } = overrides;
  return {
    threadId: "t1",
    turnId: "turn-1",
    providerId: "fake",
    providerThreadId: "pt-1",
    providerRequestId: "req-1",
    status: "pending",
    statusReason: null,
    createdAt: 100,
    resolvedAt: null,
    payload: { kind: "user_question", questions },
    resolution: null,
    ...rest,
  };
}

export function pluginInteraction(
  overrides: Partial<PluginPendingInteraction> & {
    id: string;
    rendererId: string;
    pluginId?: string;
    data: JsonValue;
  },
): PluginPendingInteraction {
  const { rendererId, pluginId = rendererId, data, ...rest } = overrides;
  return {
    threadId: "t1",
    turnId: null,
    status: "pending",
    statusReason: null,
    createdAt: 100,
    resolvedAt: null,
    origin: { kind: "plugin", pluginId, rendererId },
    payload: { kind: "plugin", title: "Plugin request", data },
    resolution: null,
    ...rest,
  };
}
