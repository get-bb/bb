import { vi } from "vitest";
import type {
  Environment,
  PendingInteraction,
  PendingInteractionApprovalDecision,
  Thread,
} from "@bb/domain";
import type {
  ThreadSchedule,
  ThreadTimelineResponse,
  TimelineRow,
  TimelineRowBase,
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
 * Mock for the `GET /threads/:id/timeline` endpoint used by `bb thread show`
 * and `bb status` to read `pendingTodos`. Tests should add this alongside
 * their `:id.$get` mock so contract drift on the timeline lane fails loudly
 * instead of silently degrading to `pendingTodos: null`.
 */
export function makeEmptyTimelineGetMock() {
  return vi.fn(async () => makeTimelineResponse([]));
}

export function makeTimelineResponse(
  rows: TimelineRow[],
): ThreadTimelineResponse {
  return {
    rows,
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
