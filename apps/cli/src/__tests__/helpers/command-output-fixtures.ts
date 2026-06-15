import { vi } from "vitest";
import type {
  Environment,
  PendingInteraction,
  PendingInteractionApprovalDecision,
  Thread,
} from "@bb/domain";
import type {
  ThreadSchedule,
  ThreadTimelineFeedResponse,
  TimelineFeedRow,
  TimelineRow,
  TimelineRowBase,
  TimelineTextPreview,
  TimelineUserConversationRow,
} from "@bb/server-contract";

interface TimelineBaseArgs {
  id: string;
  sourceSeqStart: number;
  sourceSeqEnd?: number;
  startedAt?: number;
  createdAt?: number;
}

interface MakeThreadArgs extends Partial<Thread> {
  id: string;
  projectId: string;
  providerId: string;
}

interface MakeThreadScheduleArgs extends Partial<ThreadSchedule> {
  id: string;
  projectId: string;
  threadId: string;
}

interface MakeEnvironmentArgs extends Partial<Environment> {
  id: string;
  projectId: string;
  hostId: string;
}

interface MakePendingInteractionArgs extends Partial<PendingInteraction> {
  id: string;
  providerId: string;
  threadId: string;
}

interface ScheduleEnabledPatchJson {
  enabled: boolean;
}

export interface ScheduleEnabledPatchRequest {
  json: ScheduleEnabledPatchJson;
}

export function makeTimelineBase(args: TimelineBaseArgs): TimelineRowBase {
  return {
    id: args.id,
    threadId: "thread-log",
    turnId: null,
    sourceSeqStart: args.sourceSeqStart,
    sourceSeqEnd: args.sourceSeqEnd ?? args.sourceSeqStart,
    startedAt: args.startedAt ?? args.createdAt ?? args.sourceSeqStart,
    createdAt: args.createdAt ?? args.sourceSeqStart,
  };
}

/**
 * Mock for the `GET /threads/:id/timeline/feed` endpoint used by `bb thread
 * show` and `bb status` to read `pendingTodos`. Tests should add this
 * alongside their `:id.$get` mock so contract drift on the timeline lane
 * fails loudly instead of silently degrading to `pendingTodos: null`.
 */
export function makeEmptyTimelineGetMock() {
  return vi.fn(async () => makeTimelineResponse([]));
}

export function makeTimelineResponse(
  rows: TimelineRow[],
): ThreadTimelineFeedResponse {
  return {
    threadId: "thread-log",
    rows: rows.map(timelineRowToFeedRow),
    activeThinking: null,
    pendingTodos: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: rows.length > 0 ? 1 : 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

function textPreview(text: string): TimelineTextPreview {
  return {
    text,
    fullLength: text.length,
    complete: true,
  };
}

function timelineRowBaseToFeedRowBase(
  row: TimelineRow,
): Pick<
  TimelineFeedRow,
  "createdAt" | "detail" | "key" | "source" | "startedAt" | "turnId"
> {
  return {
    key: row.id,
    turnId: row.turnId,
    source: {
      start: row.sourceSeqStart,
      end: row.sourceSeqEnd,
    },
    startedAt: row.startedAt,
    createdAt: row.createdAt,
    detail: null,
  };
}

function timelineRowToFeedRow(row: TimelineRow): TimelineFeedRow {
  const base = timelineRowBaseToFeedRowBase(row);
  switch (row.kind) {
    case "conversation":
      if (row.role === "user") {
        return {
          ...base,
          kind: "conversation",
          role: "user",
          textPreview: textPreview(row.text),
          attachments: row.attachments,
          initiator: row.initiator,
          senderThreadId: row.senderThreadId,
          turnRequest: row.turnRequest,
          mentions: row.mentions,
        };
      }
      return {
        ...base,
        kind: "conversation",
        role: "assistant",
        textPreview: textPreview(row.text),
        attachments: row.attachments,
        turnRequest: null,
      };
    case "system":
      if (row.systemKind === "operation") {
        if (row.operationKind === "parent-change") {
          return {
            ...base,
            kind: "system",
            systemKind: "operation",
            operationKind: "parent-change",
            title: row.title,
            detailPreview: row.detail === null ? null : textPreview(row.detail),
            status: row.status,
            parentChange: row.parentChange,
            completedAt: row.completedAt,
          };
        }
        return {
          ...base,
          kind: "system",
          systemKind: "operation",
          operationKind: row.operationKind,
          title: row.title,
          detailPreview: row.detail === null ? null : textPreview(row.detail),
          status: row.status,
          completedAt: row.completedAt,
        };
      }
      return {
        ...base,
        kind: "system",
        systemKind: row.systemKind,
        title: row.title,
        detailPreview: row.detail === null ? null : textPreview(row.detail),
        status: row.status,
      };
    case "turn":
      return {
        ...base,
        kind: "turn",
        turnId: row.turnId,
        status: row.status,
        summaryCount: row.summaryCount,
        completedAt: row.completedAt,
        children:
          row.children === null ? null : row.children.map(timelineRowToFeedRow),
      };
    case "work":
      switch (row.workKind) {
        case "command":
          return {
            ...base,
            kind: "work",
            workKind: "command",
            status: row.status,
            callId: row.callId,
            command: row.command,
            cwd: row.cwd,
            sourceLabel: row.source,
            outputPreview: textPreview(row.output),
            exitCode: row.exitCode,
            completedAt: row.completedAt,
            approvalStatus: row.approvalStatus,
            activityIntents: row.activityIntents,
          };
        case "file-change":
          return {
            ...base,
            kind: "work",
            workKind: "file-change",
            status: row.status,
            callId: row.callId,
            change: {
              path: row.change.path,
              kind: row.change.kind,
              movePath: row.change.movePath,
              diffPreview:
                row.change.diff === null ? null : textPreview(row.change.diff),
              diffStats: row.change.diffStats,
            },
            stdoutPreview: row.stdout === null ? null : textPreview(row.stdout),
            stderrPreview: row.stderr === null ? null : textPreview(row.stderr),
            approvalStatus: row.approvalStatus,
          };
        case "tool":
          return {
            ...base,
            kind: "work",
            workKind: "tool",
            status: row.status,
            callId: row.callId,
            toolName: row.toolName,
            toolArgs: row.toolArgs,
            outputPreview: textPreview(row.output),
            completedAt: row.completedAt,
            approvalStatus: row.approvalStatus,
            activityIntents: row.activityIntents,
          };
        default:
          throw new Error(`Unsupported test timeline row: ${row.workKind}`);
      }
  }
}

export function makePendingSteerTimelineRow(): TimelineUserConversationRow {
  return {
    ...makeTimelineBase({
      id: "pending-steer-1",
      sourceSeqStart: 12,
    }),
    kind: "conversation",
    role: "user",
    text: "Please switch to the safer plan",
    attachments: null,
    mentions: [],
    initiator: "user",
    senderThreadId: null,
    turnRequest: { kind: "steer", status: "pending" },
  };
}

export function makeThread(overrides: MakeThreadArgs): Thread {
  return {
    status: "idle",
    title: null,
    titleFallback: null,
    automationId: null,
    environmentId: null,
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function makeThreadSchedule(
  overrides: MakeThreadScheduleArgs,
): ThreadSchedule {
  return {
    name: "Daily recap",
    enabled: true,
    kind: "cron",
    cron: "0 8 * * 1-5",
    timezone: "UTC",
    prompt: "Review current work.",
    nextFireAt: 1_800_000_000_000,
    lastFiredAt: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

export function makeEnvironment(overrides: MakeEnvironmentArgs): Environment {
  return {
    name: null,
    path: "/tmp/environment",
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    branchName: "bb/thread",
    defaultBranch: "main",
    baseBranch: null,
    mergeBaseBranch: null,
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function makePendingInteraction(
  overrides: MakePendingInteractionArgs,
): PendingInteraction {
  // The provider request/thread/turn ids are incidental to every assertion, so
  // derive them from the interaction id suffix (`int-foo` -> `request-foo`,
  // `provider-thread-foo`, `turn-foo`) instead of repeating them per call.
  const suffix = overrides.id.startsWith("int-")
    ? overrides.id.slice("int-".length)
    : overrides.id;
  return {
    createdAt: Date.now(),
    providerRequestId: `request-${suffix}`,
    providerThreadId: `provider-thread-${suffix}`,
    turnId: `turn-${suffix}`,
    payload: {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item-1",
        command: "git push",
        cwd: "/tmp/project",
        actions: [],
        sessionGrant: null,
      },
      reason: "Approve command",
      availableDecisions: ["allow_once", "allow_for_session", "deny"],
    },
    resolution: null,
    resolvedAt: null,
    status: "pending",
    statusReason: null,
    ...overrides,
  };
}

export function makeCommandApprovalPayload(
  itemId: string,
  availableDecisions: PendingInteractionApprovalDecision[] = [
    "allow_once",
    "allow_for_session",
    "deny",
  ],
): PendingInteraction["payload"] {
  return {
    kind: "approval",
    subject: {
      kind: "command",
      itemId,
      command: "git push",
      cwd: "/tmp/project",
      actions: [],
      sessionGrant: null,
    },
    reason: "Approve command",
    availableDecisions,
  };
}

export function makeFileChangeApprovalPayload(
  itemId: string,
): PendingInteraction["payload"] {
  return {
    kind: "approval",
    subject: {
      kind: "file_change",
      itemId,
      writeScope: null,
      sessionGrant: null,
    },
    reason: "Approve file changes",
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  };
}

export function makeUserQuestionPayload(): PendingInteraction["payload"] {
  return {
    kind: "user_question",
    questions: [
      {
        id: "question-1",
        prompt: "Which deployment path?",
        shortLabel: "Path",
        multiSelect: false,
        options: [
          { value: "staging", label: "Staging" },
          { value: "production", label: "Production" },
        ],
        allowFreeText: true,
      },
    ],
  };
}

export function makeMultiUserQuestionPayload(): PendingInteraction["payload"] {
  return {
    kind: "user_question",
    questions: [
      {
        id: "question-1",
        prompt: "Which deployment path?",
        shortLabel: "Path",
        multiSelect: false,
        options: [
          { value: "staging", label: "Staging" },
          { value: "production", label: "Production" },
        ],
        allowFreeText: false,
      },
      {
        id: "question-2",
        prompt: "Any rollout notes?",
        shortLabel: "Notes",
        multiSelect: false,
        allowFreeText: true,
      },
    ],
  };
}

export function makePermissionGrantApprovalPayload(
  itemId: string,
): PendingInteraction["payload"] {
  return {
    kind: "approval",
    subject: {
      kind: "permission_grant",
      itemId,
      toolName: null,
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: ["/tmp/project/README.md"],
          write: ["/tmp/project/notes.md"],
        },
      },
    },
    reason: "Grant workspace access",
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
  };
}
