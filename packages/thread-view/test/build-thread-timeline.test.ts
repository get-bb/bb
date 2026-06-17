import { threadScope, turnScope } from "@bb/domain";
import type {
  ApprovalPendingInteractionResolution,
  JsonObject,
  OwnershipChangeOperationAction,
  ProviderErrorInfo,
  ThreadEventFileChange,
  ThreadEventItemStatus,
  UserQuestionPendingInteractionResolution,
} from "@bb/domain";
import type {
  TimelineApprovalWorkRow,
  ThreadContextWindowUsage,
  TimelineFileChangeWorkRow,
  TimelineImageViewWorkRow,
  TimelineParentChange,
  TimelineQuestionWorkRow,
  TimelineRow,
  TimelineSystemRow,
  TimelineToolWorkRow,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildThreadTimelineFromEvents,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type ThreadEventWithMeta,
} from "../src/index.js";
import { parseOperationMessage } from "../src/parse-operation-message.js";
import {
  createTimelineEventFactory,
  fromRows,
} from "./timeline-test-harness.js";

interface ContextWindowUsageEventArgs {
  estimated: boolean;
  modelContextWindow: number | null;
  seq: number;
  usedTokens: number | null;
}

interface FileChangeItemEventArgs {
  changes: ThreadEventFileChange[];
  itemId?: string;
  seq: number;
  status?: ThreadEventItemStatus;
  type: "item/completed" | "item/started";
}

interface ToolCallItemEventArgs {
  itemId?: string;
  result?: string;
  seq: number;
  status?: ThreadEventItemStatus;
  tool: string;
  toolArgs?: JsonObject;
  type: "item/completed" | "item/started";
}

interface ImageViewItemEventArgs {
  itemId?: string;
  path?: string;
  seq: number;
  type: "item/completed" | "item/started";
}

interface TurnStartedEventArgs {
  seq: number;
}

interface TurnCompletedEventArgs {
  errorMessage?: string;
  seq: number;
  status?: "completed" | "failed" | "interrupted";
}

interface SystemOperationEventArgs {
  message: string;
  metadata?: JsonObject;
  operation?: string;
  operationId?: string;
  seq: number;
  status?: "running" | "completed" | "failed";
}

interface PermissionGrantLifecycleEventArgs {
  interactionId?: string;
  resolution?: ApprovalPendingInteractionResolution | null;
  seq: number;
  status?: "pending" | "resolving" | "resolved" | "interrupted";
  statusReason?: string | null;
  toolName?: string | null;
}

interface SystemErrorEventArgs {
  code?: string;
  detail?: string;
  message: string;
  seq: number;
}

interface SystemProviderTurnWatchdogEventArgs {
  activeTurnId?: string;
  activeTurnStartedAt?: number;
  elapsedMs?: number;
  firedAt?: number;
  lastActivityEventAt?: number;
  lastActivityEventSequence?: number;
  lastActivityEventType?: string;
  providerId?: string;
  providerThreadId?: string | null;
  seq: number;
  thresholdMs?: number;
}

interface ProviderErrorEventArgs {
  detail?: string;
  errorInfo?: ProviderErrorInfo;
  message?: string;
  seq: number;
  willRetry?: boolean;
}

interface UserQuestionLifecycleEventArgs {
  interactionId?: string;
  questionPrompt?: string;
  resolution?: UserQuestionPendingInteractionResolution | null;
  seq: number;
  status?: "pending" | "resolving" | "resolved" | "interrupted";
  statusReason?: string | null;
}

type BuildTimelineRowsThreadStatus = "active" | "idle";

interface OwnershipOperationCase {
  action: OwnershipChangeOperationAction;
  parentChangeAction: TimelineParentChange["action"];
  message: string;
  nextParentThreadId: string | null;
  nextParentThreadTitle: string | null;
  previousParentThreadId: string | null;
  previousParentThreadTitle: string | null;
}

const ownershipOperationCases: OwnershipOperationCase[] = [
  {
    action: "assign",
    parentChangeAction: "assign",
    // Unnamed thread (no threadName option) → bare capitalized verb + parent name.
    message: "Assigned to Parent",
    nextParentThreadId: "thr-parent",
    nextParentThreadTitle: "Parent",
    previousParentThreadId: null,
    previousParentThreadTitle: null,
  },
  {
    action: "release",
    parentChangeAction: "release",
    message: "Released from Parent",
    nextParentThreadId: null,
    nextParentThreadTitle: null,
    previousParentThreadId: "thr-parent",
    previousParentThreadTitle: "Parent",
  },
  {
    action: "transfer",
    parentChangeAction: "transfer",
    message: "Transferred to Next Parent",
    nextParentThreadId: "thr-parent-next",
    nextParentThreadTitle: "Next Parent",
    previousParentThreadId: "thr-parent-previous",
    previousParentThreadTitle: "Previous Parent",
  },
];

function contextWindowUsageEvent({
  estimated,
  modelContextWindow,
  seq,
  usedTokens,
}: ContextWindowUsageEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "thread/contextWindowUsage/updated",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope(`turn-${seq}`),
      contextWindowUsage: {
        estimated,
        modelContextWindow,
        usedTokens,
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function fileChangeItemEvent({
  changes,
  itemId = "file-edit-1",
  seq,
  status,
  type,
}: FileChangeItemEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type,
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      item: {
        type: "fileChange",
        id: itemId,
        changes,
        status: status ?? (type === "item/completed" ? "completed" : "pending"),
        approvalStatus: null,
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function toolCallItemEvent({
  itemId = "tool-call-1",
  result,
  seq,
  status,
  tool,
  toolArgs,
  type,
}: ToolCallItemEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type,
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      item: {
        type: "toolCall",
        id: itemId,
        tool,
        ...(toolArgs ? { arguments: toolArgs } : {}),
        status: status ?? (type === "item/completed" ? "completed" : "pending"),
        ...(result ? { result } : {}),
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function imageViewItemEvent({
  itemId = "image-view-1",
  path = "/tmp/sightglass-quote-merge-check/dashboard-main.png",
  seq,
  type,
}: ImageViewItemEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type,
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      item: {
        type: "imageView",
        id: itemId,
        path,
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function turnStartedEvent({ seq }: TurnStartedEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "turn/started",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function turnCompletedEvent({
  errorMessage,
  seq,
  status = "completed",
}: TurnCompletedEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "turn/completed",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      status,
      ...(errorMessage ? { error: { message: errorMessage } } : {}),
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function systemOperationEvent({
  message,
  metadata,
  operation = "ownership_change",
  operationId = "operation-1",
  seq,
  status = "completed",
}: SystemOperationEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "system/operation",
      threadId: "thread-1",
      scope: threadScope(),
      message,
      operation,
      operationId,
      status,
      ...(metadata ? { metadata } : {}),
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function systemErrorEvent({
  code,
  detail,
  message,
  seq,
}: SystemErrorEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "system/error",
      threadId: "thread-1",
      scope: threadScope(),
      message,
      ...(code !== undefined ? { code } : {}),
      ...(detail !== undefined ? { detail } : {}),
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function systemProviderTurnWatchdogEvent({
  activeTurnId = "turn-1",
  activeTurnStartedAt = 1,
  elapsedMs = 901_000,
  firedAt,
  lastActivityEventAt = 100,
  lastActivityEventSequence = 2,
  lastActivityEventType = "turn/input/accepted",
  providerId = "codex",
  providerThreadId = "provider-thread-1",
  seq,
  thresholdMs = 900_000,
}: SystemProviderTurnWatchdogEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "system/provider-turn-watchdog",
      threadId: "thread-1",
      scope: threadScope(),
      reason: "provider-turn-idle",
      thresholdMs,
      elapsedMs,
      activeTurnId,
      activeTurnStartedAt,
      lastActivityEventSequence,
      lastActivityEventType,
      lastActivityEventAt,
      providerId,
      providerThreadId,
      firedAt: firedAt ?? seq,
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function providerErrorEvent({
  detail,
  errorInfo,
  message = "Provider error",
  seq,
  willRetry,
}: ProviderErrorEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "provider/error",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      message,
      ...(detail !== undefined ? { detail } : {}),
      ...(errorInfo !== undefined ? { errorInfo } : {}),
      ...(willRetry !== undefined ? { willRetry } : {}),
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function permissionGrantLifecycleEvent({
  interactionId = "pi-permission-grant",
  resolution = null,
  seq,
  status = "pending",
  statusReason = null,
  toolName = "Bash",
}: PermissionGrantLifecycleEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "system/permissionGrant/lifecycle",
      threadId: "thread-1",
      scope: turnScope("turn-1"),
      interactionId,
      providerId: "codex",
      providerRequestId: "request-permission-grant",
      status,
      resolution,
      statusReason,
      subject: {
        kind: "permission_grant",
        itemId: "item-permission-grant",
        toolName,
        permissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function userQuestionLifecycleEvent({
  interactionId = "pi-user-question",
  questionPrompt,
  resolution = null,
  seq,
  status = "pending",
  statusReason = null,
}: UserQuestionLifecycleEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "system/userQuestion/lifecycle",
      threadId: "thread-1",
      scope: turnScope("turn-1"),
      interactionId,
      providerId: "claude-code",
      providerRequestId: "request-user-question",
      status,
      resolution,
      statusReason,
      payload: {
        kind: "user_question",
        questions: [
          {
            id: "question-1",
            prompt: questionPrompt ?? "Which deployment target should I use?",
            shortLabel: "Target",
            multiSelect: false,
            options: [
              { value: "staging", label: "Staging" },
              { value: "production", label: "Production" },
            ],
            allowFreeText: true,
          },
        ],
      },
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function buildContextWindowUsage(
  contextWindowEvents: ThreadEventWithMeta[],
): ThreadContextWindowUsage | null {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents,
    events: [],
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: false,
      includeProviderUnhandledOperations: false,
      isLatestPage: true,
      threadStatus: "idle",
      threadName: "",
      turnMessageDetail: "summary",
      workspaceRoot: null,
    },
  }).contextWindowUsage;
}

function buildTimelineRows(
  events: ThreadEventWithMeta[],
  threadStatus: BuildTimelineRowsThreadStatus = "idle",
  workspaceRoot: string | null = null,
): TimelineRow[] {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events,
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: true,
      includeProviderUnhandledOperations: false,
      isLatestPage: true,
      threadStatus,
      threadName: "",
      turnMessageDetail: "full",
      workspaceRoot,
    },
  }).rows;
}

function buildTimelineRowsWithAcceptedContext(
  events: ThreadEventWithMeta[],
  acceptedClientRequestEvents: ThreadEventWithMeta[],
): TimelineRow[] {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: {
      acceptedClientRequestEvents,
    },
    contextWindowEvents: [],
    events,
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: true,
      includeProviderUnhandledOperations: false,
      isLatestPage: true,
      threadStatus: "idle",
      threadName: "",
      turnMessageDetail: "full",
      workspaceRoot: null,
    },
  }).rows;
}

function isFileChangeRow(row: TimelineRow): row is TimelineFileChangeWorkRow {
  return row.kind === "work" && row.workKind === "file-change";
}

function isToolRow(row: TimelineRow): row is TimelineToolWorkRow {
  return row.kind === "work" && row.workKind === "tool";
}

function collectFileChangeRows(
  rows: readonly TimelineRow[],
): TimelineFileChangeWorkRow[] {
  const fileChangeRows: TimelineFileChangeWorkRow[] = [];
  for (const row of rows) {
    if (isFileChangeRow(row)) {
      fileChangeRows.push(row);
      continue;
    }
    if (row.kind === "turn" && row.children) {
      fileChangeRows.push(...collectFileChangeRows(row.children));
      continue;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      fileChangeRows.push(...collectFileChangeRows(row.childRows));
    }
  }
  return fileChangeRows;
}

function collectToolRows(rows: readonly TimelineRow[]): TimelineToolWorkRow[] {
  const toolRows: TimelineToolWorkRow[] = [];
  for (const row of rows) {
    if (isToolRow(row)) {
      toolRows.push(row);
      continue;
    }
    if (row.kind === "turn" && row.children) {
      toolRows.push(...collectToolRows(row.children));
      continue;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      toolRows.push(...collectToolRows(row.childRows));
    }
  }
  return toolRows;
}

function collectApprovalRows(
  rows: readonly TimelineRow[],
): TimelineApprovalWorkRow[] {
  const approvalRows: TimelineApprovalWorkRow[] = [];
  for (const row of rows) {
    if (row.kind === "work" && row.workKind === "approval") {
      approvalRows.push(row);
      continue;
    }
    if (row.kind === "turn" && row.children) {
      approvalRows.push(...collectApprovalRows(row.children));
      continue;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      approvalRows.push(...collectApprovalRows(row.childRows));
    }
  }
  return approvalRows;
}

function collectQuestionRows(
  rows: readonly TimelineRow[],
): TimelineQuestionWorkRow[] {
  const questionRows: TimelineQuestionWorkRow[] = [];
  for (const row of rows) {
    if (row.kind === "work" && row.workKind === "question") {
      questionRows.push(row);
      continue;
    }
    if (row.kind === "turn" && row.children) {
      questionRows.push(...collectQuestionRows(row.children));
      continue;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      questionRows.push(...collectQuestionRows(row.childRows));
    }
  }
  return questionRows;
}

function collectImageViewRows(
  rows: readonly TimelineRow[],
): TimelineImageViewWorkRow[] {
  const imageViewRows: TimelineImageViewWorkRow[] = [];
  for (const row of rows) {
    if (row.kind === "work" && row.workKind === "image-view") {
      imageViewRows.push(row);
      continue;
    }
    if (row.kind === "turn" && row.children) {
      imageViewRows.push(...collectImageViewRows(row.children));
      continue;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      imageViewRows.push(...collectImageViewRows(row.childRows));
    }
  }
  return imageViewRows;
}

function collectSystemRows(rows: readonly TimelineRow[]): TimelineSystemRow[] {
  const systemRows: TimelineSystemRow[] = [];
  for (const row of rows) {
    if (row.kind === "system") {
      systemRows.push(row);
      continue;
    }
    if (row.kind === "turn" && row.children) {
      systemRows.push(...collectSystemRows(row.children));
      continue;
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      systemRows.push(...collectSystemRows(row.childRows));
    }
  }
  return systemRows;
}

function fileChangeRowIdByPath(
  rows: readonly TimelineFileChangeWorkRow[],
): Record<string, string> {
  const idByPath: Record<string, string> = {};
  for (const row of rows) {
    idByPath[row.change.path] = row.id;
  }
  return idByPath;
}

describe("buildThreadTimelineFromEvents", () => {
  it("does not project thread-start provider-session markers as provisioning rows", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const providerSessionMarker = event.threadProvisioning({
      provisioningId: "thread-start:exec_1",
      status: "completed",
      entries: [],
    });

    const rows = buildTimelineRows(
      fromRows([
        event.threadProvisioning({
          provisioningId: "tpv-real",
          status: "completed",
          entries: [],
        }),
        providerSessionMarker,
      ]),
    );

    expect(
      collectSystemRows(rows).filter(
        (row) =>
          row.systemKind === "operation" && row.title === "Provisioned",
      ),
    ).toHaveLength(1);
  });

  it("normalizes carriage-return provisioning output in operation detail", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const rows = buildTimelineRows(
      fromRows([
        event.threadProvisioning({
          status: "active",
          entries: [
            {
              type: "output",
              key: "git-worktree-output-1",
              text: [
                "Preparing worktree (new branch 'bb/example')\n",
                "Updating files:  44% (1017/2287)\r",
                "Updating files:  45% (1030/2287)\r",
                "Updating files: 100% (2287/2287), done.",
              ].join(""),
            },
          ],
        }),
      ]),
    );

    const [row] = rows;
    if (!row || row.kind !== "system") {
      throw new Error("Expected a system row");
    }

    expect(row.detail).toBe(
      [
        "Preparing worktree (new branch 'bb/example')",
        "Updating files: 100% (2287/2287), done.",
      ].join("\n"),
    );
    expect(row.detail).not.toContain("44%");
    expect(row.detail).not.toContain("\r");
  });

  it("projects image view item events as timeline work rows", () => {
    const completedRows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      imageViewItemEvent({
        seq: 2,
        type: "item/started",
      }),
      imageViewItemEvent({
        seq: 3,
        type: "item/completed",
      }),
    ]);
    const [completedRow] = collectImageViewRows(completedRows);
    if (!completedRow) {
      throw new Error("Expected an image view row");
    }

    expect(completedRow).toMatchObject({
      workKind: "image-view",
      callId: "image-view-1",
      path: "/tmp/sightglass-quote-merge-check/dashboard-main.png",
      status: "completed",
      completedAt: 3,
    });

    const pendingRows = buildTimelineRows(
      [
        turnStartedEvent({ seq: 4 }),
        imageViewItemEvent({
          seq: 5,
          type: "item/started",
        }),
      ],
      "active",
    );
    const [pendingRow] = collectImageViewRows(pendingRows);
    if (!pendingRow) {
      throw new Error("Expected an image view row");
    }

    expect(pendingRow).toMatchObject({
      workKind: "image-view",
      status: "pending",
      completedAt: null,
    });
  });

  it("interrupts a pending image view row when its turn is interrupted", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      imageViewItemEvent({
        seq: 2,
        type: "item/started",
      }),
      turnCompletedEvent({
        seq: 3,
        status: "interrupted",
      }),
    ]);

    const imageViewRows = collectImageViewRows(rows);
    expect(imageViewRows).toEqual([
      expect.objectContaining({
        callId: "image-view-1",
        status: "interrupted",
        startedAt: 2,
        completedAt: 3,
      }),
    ]);
  });

  it("completes an image view row after its start has flushed to history", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      imageViewItemEvent({
        seq: 2,
        type: "item/started",
      }),
      toolCallItemEvent({
        itemId: "tool-call-1",
        seq: 3,
        tool: "Read",
        toolArgs: { file_path: "apps/app/src/main.tsx" },
        type: "item/started",
      }),
      imageViewItemEvent({
        seq: 4,
        type: "item/completed",
      }),
    ]);

    const imageViewRows = collectImageViewRows(rows);
    expect(imageViewRows).toEqual([
      expect.objectContaining({
        callId: "image-view-1",
        status: "completed",
        startedAt: 2,
        completedAt: 4,
        sourceSeqEnd: 4,
      }),
    ]);
  });

  it("keeps an out-of-order image view completion finalized when its start replays later", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      imageViewItemEvent({
        seq: 2,
        type: "item/completed",
      }),
      imageViewItemEvent({
        seq: 3,
        type: "item/started",
      }),
    ]);

    const imageViewRows = collectImageViewRows(rows);
    expect(imageViewRows).toEqual([
      expect.objectContaining({
        callId: "image-view-1",
        status: "completed",
        startedAt: 2,
        completedAt: 2,
        sourceSeqEnd: 2,
      }),
    ]);
  });

  it("ignores duplicate image view lifecycle replays after finalization", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      imageViewItemEvent({
        seq: 2,
        type: "item/started",
      }),
      imageViewItemEvent({
        seq: 3,
        type: "item/completed",
      }),
      imageViewItemEvent({
        seq: 4,
        type: "item/started",
      }),
      imageViewItemEvent({
        seq: 5,
        type: "item/completed",
      }),
    ]);

    const imageViewRows = collectImageViewRows(rows);
    expect(imageViewRows).toEqual([
      expect.objectContaining({
        callId: "image-view-1",
        status: "completed",
        startedAt: 2,
        completedAt: 3,
        sourceSeqEnd: 3,
      }),
    ]);
  });

  it("uses accepted context to suppress pending steers without rendering future accepted rows", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const turnStarted = event.turnStarted({ turnId: "turn-1" });
    const steerRequest = event.clientTurnRequested({
      target: { kind: "auto", expectedTurnId: "turn-1" },
      text: "Please account for the restart",
    });
    const acceptedContext = fromRows([
      event.inputAccepted({
        clientRequestId: steerRequest.data.requestId,
        turnId: "turn-1",
      }),
    ]);

    const rows = buildTimelineRowsWithAcceptedContext(
      fromRows([turnStarted, steerRequest]),
      acceptedContext,
    );

    expect(
      rows.filter((row) => row.kind === "conversation" && row.role === "user"),
    ).toHaveLength(0);
  });

  it("uses accepted context to classify stale steers as messages when the accepted turn is visible", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const turnStarted = event.turnStarted({ turnId: "turn-1" });
    const steerRequest = event.clientTurnRequested({
      target: { kind: "auto", expectedTurnId: "turn-1" },
      text: "Start a fresh attempt",
    });
    const fallbackTurnStarted = event.turnStarted({ turnId: "turn-2" });
    const acceptedContext = fromRows([
      event.inputAccepted({
        clientRequestId: steerRequest.data.requestId,
        turnId: "turn-2",
      }),
    ]);

    const rows = buildTimelineRowsWithAcceptedContext(
      fromRows([turnStarted, steerRequest, fallbackTurnStarted]),
      acceptedContext,
    );
    const userRows = rows.filter(
      (row) => row.kind === "conversation" && row.role === "user",
    );

    expect(userRows).toHaveLength(1);
    expect(userRows[0]).toMatchObject({
      text: "Start a fresh attempt",
      turnRequest: {
        kind: "message",
        status: "accepted",
      },
    });
  });

  it.each(ownershipOperationCases)(
    "uses $action ownership metadata rather than event message for operation titles",
    ({
      action,
      message,
      nextParentThreadId,
      nextParentThreadTitle,
      previousParentThreadId,
      previousParentThreadTitle,
    }) => {
      const event = systemOperationEvent({
        message: "Ownership operation completed",
        metadata: {
          action,
          nextParentThreadId,
          nextParentThreadTitle,
          previousParentThreadId,
          previousParentThreadTitle,
        },
        seq: 1,
      });

      expect(parseOperationMessage(event.event, event.meta)).toMatchObject({
        kind: "operation",
        title: message,
      });
    },
  );

  it("uses a neutral completed ownership title for legacy metadata", () => {
    const event = systemOperationEvent({
      message: "Ownership operation completed",
      metadata: {
        action: "unknown-action",
        nextParentThreadId: null,
        nextParentThreadTitle: null,
        previousParentThreadId: null,
        previousParentThreadTitle: null,
      },
      seq: 1,
    });

    expect(parseOperationMessage(event.event, event.meta)).toMatchObject({
      kind: "operation",
      title: "Ownership change completed",
    });
  });

  it.each(ownershipOperationCases)(
    "does not duplicate $action ownership operation titles as row detail",
    ({
      action,
      parentChangeAction,
      message,
      nextParentThreadId,
      nextParentThreadTitle,
      previousParentThreadId,
      previousParentThreadTitle,
    }) => {
      const rows = buildTimelineRows([
        systemOperationEvent({
          message,
          metadata: {
            action,
            nextParentThreadId,
            nextParentThreadTitle,
            previousParentThreadId,
            previousParentThreadTitle,
          },
          seq: 1,
        }),
      ]);

      expect(collectSystemRows(rows)).toEqual([
        expect.objectContaining({
          detail: null,
          parentChange: {
            action: parentChangeAction,
            previousParentThreadId: previousParentThreadId,
            previousParentThreadTitle: previousParentThreadTitle,
            nextParentThreadId: nextParentThreadId,
            nextParentThreadTitle: nextParentThreadTitle,
          },
          operationKind: "parent-change",
          systemKind: "operation",
          title: message,
        }),
      ]);
    },
  );

  it("keeps system error message and detail as separate row fields", () => {
    const rows = buildTimelineRows([
      systemErrorEvent({
        code: "thread_command_failed",
        message: "Command thread/start failed",
        detail:
          "Error: Cannot find claude code binary\n  at resolveBinary (sdk.js:42)\n  at start (sdk.js:88)",
        seq: 1,
      }),
    ]);

    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        systemKind: "error",
        status: "error",
        title: "Command thread/start failed",
        detail:
          "Error: Cannot find claude code binary\n  at resolveBinary (sdk.js:42)\n  at start (sdk.js:88)",
      }),
    ]);
  });

  it("leaves system error detail null when only message is provided", () => {
    const rows = buildTimelineRows([
      systemErrorEvent({
        code: "provider_runtime_error",
        message: "Provider runtime is unavailable",
        seq: 1,
      }),
    ]);

    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        systemKind: "error",
        title: "Provider runtime is unavailable",
        detail: null,
      }),
    ]);
  });

  it("uses structured provider error info for provider error titles", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      providerErrorEvent({
        detail: "You've hit your limit - resets at 2:00 PM",
        errorInfo: {
          category: "rate-limit",
          providerCode: "usageLimitExceeded",
          httpStatusCode: null,
        },
        seq: 2,
      }),
    ]);

    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        systemKind: "error",
        status: "error",
        title: "Provider rate limit reached",
        detail: "You've hit your limit - resets at 2:00 PM",
      }),
    ]);
  });

  it("keeps error rows in the regular timeline", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      providerErrorEvent({
        detail: "The provider stream closed unexpectedly",
        seq: 2,
      }),
      systemErrorEvent({
        code: "thread_command_failed",
        message: "Command turn.submit failed",
        detail: "Payload exceeded provider limit",
        seq: 3,
      }),
    ]);

    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        systemKind: "error",
        status: "error",
        title: "The provider stream closed unexpectedly",
      }),
      expect.objectContaining({
        systemKind: "error",
        status: "error",
        title: "Command turn.submit failed",
        detail: "Payload exceeded provider limit",
      }),
    ]);
  });

  it("uses legacy provider error detail as the title for generic provider errors", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      providerErrorEvent({
        detail: "API Error: Overloaded",
        seq: 2,
      }),
    ]);

    // No category to summarize, so the message becomes the title and the
    // duplicate detail is dropped — the row renders as a single line.
    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        systemKind: "error",
        status: "error",
        title: "API Error: Overloaded",
        detail: null,
      }),
    ]);
  });

  it("titles retrying provider errors with their reconnect progress, error in the body", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      providerErrorEvent({
        detail:
          "Reconnecting... 3/5\nstream disconnected before completion: Network is unreachable (os error 51)",
        seq: 2,
        willRetry: true,
      }),
    ]);

    // Reconnect rows are informational markers, not in-progress work, so they
    // carry no lifecycle status.
    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        systemKind: "reconnect",
        status: null,
        title: "Reconnecting... 3/5",
        detail:
          "stream disconnected before completion: Network is unreachable (os error 51)",
      }),
    ]);
  });

  it("falls back to a generic title and keeps the full message in the body when an error is too long to read inline", () => {
    const longMessage =
      "There's an issue with the selected model (opus-4.7). It may not exist or you may not have access to it. Run --model to pick a different model.";
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 1 }),
      providerErrorEvent({ detail: longMessage, seq: 2 }),
    ]);

    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        systemKind: "error",
        status: "error",
        title: "Provider error",
        detail: longMessage,
      }),
    ]);
  });

  it("renders provider turn watchdog diagnostics as an error operation row", () => {
    const rows = buildTimelineRows([
      systemProviderTurnWatchdogEvent({ seq: 1 }),
    ]);

    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        systemKind: "operation",
        operationKind: "generic",
        status: "error",
        title: "Provider turn stopped responding",
        detail: "No provider activity for 901s after turn/input/accepted",
      }),
    ]);
  });

  it("uses a neutral completed ownership title for invalid ownership actions", () => {
    const rows = buildTimelineRows([
      systemOperationEvent({
        message: "Thread ownership updated by migration",
        metadata: {
          action: "migrate",
          nextParentThreadId: "thr-parent",
          nextParentThreadTitle: "Parent",
          previousParentThreadId: null,
          previousParentThreadTitle: null,
        },
        seq: 1,
      }),
    ]);

    expect(collectSystemRows(rows)).toEqual([
      expect.objectContaining({
        detail: "Thread ownership updated by migration",
        operationKind: "generic",
        systemKind: "operation",
        title: "Ownership change completed",
      }),
    ]);
    expect(collectSystemRows(rows)[0]).not.toHaveProperty("parentChange");
  });

  it.each([
    {
      expectedRowStatus: "pending",
      operationStatus: "running",
      threadStatus: "active",
    },
    {
      expectedRowStatus: "error",
      operationStatus: "failed",
      threadStatus: "idle",
    },
  ] satisfies Array<{
    expectedRowStatus: "error" | "pending";
    operationStatus: "failed" | "running";
    threadStatus: BuildTimelineRowsThreadStatus;
  }>)(
    "keeps parent change typing for $operationStatus operation status",
    ({ expectedRowStatus, operationStatus, threadStatus }) => {
      const rows = buildTimelineRows(
        [
          systemOperationEvent({
            message: `Ownership change ${operationStatus}`,
            metadata: {
              action: "assign",
              nextParentThreadId: "thr-parent",
              nextParentThreadTitle: "Parent",
              previousParentThreadId: null,
              previousParentThreadTitle: null,
            },
            seq: 1,
            status: operationStatus,
          }),
        ],
        threadStatus,
      );

      expect(collectSystemRows(rows)).toEqual([
        expect.objectContaining({
          parentChange: {
            action: "assign",
            previousParentThreadId: null,
            previousParentThreadTitle: null,
            nextParentThreadId: "thr-parent",
            nextParentThreadTitle: "Parent",
          },
          operationKind: "parent-change",
          status: expectedRowStatus,
          systemKind: "operation",
        }),
      ]);
    },
  );

  it.each([
    {
      expectedGrantScope: "turn",
      resolution: {
        decision: "allow_once",
        grantedPermissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
    },
    {
      expectedGrantScope: "session",
      resolution: {
        decision: "allow_for_session",
        grantedPermissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
    },
  ] satisfies Array<{
    expectedGrantScope: "turn" | "session";
    resolution: ApprovalPendingInteractionResolution;
  }>)(
    "preserves permission grant $expectedGrantScope scope on timeline rows",
    ({ expectedGrantScope, resolution }) => {
      const rows = buildTimelineRows([
        turnStartedEvent({ seq: 0 }),
        permissionGrantLifecycleEvent({
          resolution,
          seq: 1,
          status: "resolved",
        }),
      ]);

      expect(collectApprovalRows(rows)).toEqual([
        expect.objectContaining({
          approvalKind: "permission-grant",
          grantScope: expectedGrantScope,
          lifecycle: "granted",
          statusReason: null,
          target: {
            itemId: "item-permission-grant",
            toolName: "Bash",
          },
        }),
      ]);
      expect(collectApprovalRows(rows)[0]).not.toHaveProperty("toolName");
    },
  );

  it.each([
    {
      expectedLifecycle: "interrupted",
      expectedStatus: "interrupted",
      status: "interrupted",
      statusReason: "Thread stopped by user request",
    },
  ] satisfies Array<{
    expectedLifecycle: "interrupted";
    expectedStatus: "interrupted";
    status: "interrupted";
    statusReason: string;
  }>)(
    "preserves permission grant $status status reason on timeline rows",
    ({ expectedLifecycle, expectedStatus, status, statusReason }) => {
      const rows = buildTimelineRows([
        turnStartedEvent({ seq: 0 }),
        permissionGrantLifecycleEvent({
          seq: 1,
          status,
          statusReason,
        }),
      ]);

      expect(collectApprovalRows(rows)).toEqual([
        expect.objectContaining({
          approvalKind: "permission-grant",
          grantScope: null,
          lifecycle: expectedLifecycle,
          status: expectedStatus,
          statusReason,
        }),
      ]);
    },
  );

  it.each([
    {
      expectedAnswers: null,
      expectedLifecycle: "pending",
      expectedStatus: "pending",
      resolution: null,
      status: "pending",
      statusReason: null,
    },
    {
      expectedAnswers: {
        "question-1": {
          selected: ["staging"],
          freeText: "Use staging until QA signs off.",
        },
      },
      expectedLifecycle: "resolving",
      expectedStatus: "pending",
      resolution: {
        kind: "user_answer",
        answers: {
          "question-1": {
            selected: ["staging"],
            freeText: "Use staging until QA signs off.",
          },
        },
      },
      status: "resolving",
      statusReason: null,
    },
    {
      expectedAnswers: {
        "question-1": {
          selected: ["staging"],
          freeText: "Use staging until QA signs off.",
        },
      },
      expectedLifecycle: "answered",
      expectedStatus: "completed",
      resolution: {
        kind: "user_answer",
        answers: {
          "question-1": {
            selected: ["staging"],
            freeText: "Use staging until QA signs off.",
          },
        },
      },
      status: "resolved",
      statusReason: null,
    },
    {
      expectedAnswers: null,
      expectedLifecycle: "interrupted",
      expectedStatus: "interrupted",
      resolution: null,
      status: "interrupted",
      statusReason: "Thread stopped by user request",
    },
  ] satisfies Array<{
    expectedAnswers: UserQuestionPendingInteractionResolution["answers"] | null;
    expectedLifecycle: "pending" | "resolving" | "answered" | "interrupted";
    expectedStatus: "pending" | "completed" | "interrupted";
    resolution: UserQuestionPendingInteractionResolution | null;
    status: "pending" | "resolving" | "resolved" | "interrupted";
    statusReason: string | null;
  }>)(
    "projects user-question $expectedLifecycle lifecycle rows",
    ({
      expectedAnswers,
      expectedLifecycle,
      expectedStatus,
      resolution,
      status,
      statusReason,
    }) => {
      const rows = buildTimelineRows([
        turnStartedEvent({ seq: 0 }),
        userQuestionLifecycleEvent({
          resolution,
          seq: 1,
          status,
          statusReason,
        }),
      ]);

      expect(collectQuestionRows(rows)).toEqual([
        expect.objectContaining({
          answers: expectedAnswers,
          interactionId: "pi-user-question",
          lifecycle: expectedLifecycle,
          questions: [
            expect.objectContaining({
              id: "question-1",
              prompt: "Which deployment target should I use?",
            }),
          ],
          status: expectedStatus,
          statusReason,
          workKind: "question",
        }),
      ]);
    },
  );

  it.each([
    { lateStatus: "pending" },
    { lateStatus: "resolving" },
  ] satisfies Array<{ lateStatus: "pending" | "resolving" }>)(
    "preserves answered user-question rows after late $lateStatus events",
    ({ lateStatus }) => {
      const answers = {
        "question-1": {
          selected: ["staging"],
          freeText: "Use staging until QA signs off.",
        },
      };
      const rows = buildTimelineRows([
        turnStartedEvent({ seq: 0 }),
        userQuestionLifecycleEvent({
          resolution: {
            kind: "user_answer",
            answers,
          },
          seq: 1,
          status: "resolved",
        }),
        userQuestionLifecycleEvent({
          questionPrompt: "Stale duplicate prompt",
          seq: 2,
          status: lateStatus,
          statusReason: "Stale update",
        }),
      ]);

      expect(collectQuestionRows(rows)).toEqual([
        expect.objectContaining({
          answers,
          lifecycle: "answered",
          questions: [
            expect.objectContaining({
              prompt: "Which deployment target should I use?",
            }),
          ],
          sourceSeqEnd: 2,
          status: "completed",
          statusReason: null,
        }),
      ]);
    },
  );

  it.each([
    {
      expectedLifecycle: "interrupted",
      expectedStatus: "interrupted",
      status: "interrupted",
      statusReason: "Thread stopped by user request",
    },
  ] satisfies Array<{
    expectedLifecycle: "interrupted";
    expectedStatus: "interrupted";
    status: "interrupted";
    statusReason: string;
  }>)(
    "preserves terminal user-question $status rows after late resolving events",
    ({ expectedLifecycle, expectedStatus, status, statusReason }) => {
      const rows = buildTimelineRows([
        turnStartedEvent({ seq: 0 }),
        userQuestionLifecycleEvent({
          seq: 1,
          status,
          statusReason,
        }),
        userQuestionLifecycleEvent({
          resolution: {
            kind: "user_answer",
            answers: {
              "question-1": {
                selected: ["production"],
              },
            },
          },
          seq: 2,
          status: "resolving",
        }),
      ]);

      expect(collectQuestionRows(rows)).toEqual([
        expect.objectContaining({
          answers: null,
          lifecycle: expectedLifecycle,
          sourceSeqEnd: 2,
          status: expectedStatus,
          statusReason,
        }),
      ]);
    },
  );

  it("suppresses low-value ToolSearch rows", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 0 }),
      toolCallItemEvent({
        seq: 1,
        tool: "ToolSearch",
        toolArgs: { query: "select:TodoWrite", max_results: 1 },
        type: "item/started",
      }),
      toolCallItemEvent({
        result: "Matched tools: TodoWrite",
        seq: 2,
        tool: "ToolSearch",
        toolArgs: { query: "select:TodoWrite", max_results: 1 },
        type: "item/completed",
      }),
    ]);

    expect(collectToolRows(rows)).toEqual([]);
  });

  it.each(["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"])(
    "suppresses pending and completed %s rows",
    (tool) => {
      const rows = buildTimelineRows([
        turnStartedEvent({ seq: 0 }),
        toolCallItemEvent({
          seq: 1,
          tool,
          toolArgs: { subject: "Hidden task tool" },
          type: "item/started",
        }),
        toolCallItemEvent({
          result: "ok",
          seq: 2,
          tool,
          toolArgs: { subject: "Hidden task tool" },
          type: "item/completed",
        }),
      ]);

      expect(collectToolRows(rows)).toEqual([]);
    },
  );

  it.each(["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"])(
    "keeps failed %s rows visible",
    (tool) => {
      const rows = buildTimelineRows([
        turnStartedEvent({ seq: 0 }),
        toolCallItemEvent({
          result: "Task tool failed",
          seq: 1,
          status: "failed",
          tool,
          toolArgs: { subject: "Failed task tool" },
          type: "item/completed",
        }),
      ]);

      expect(collectToolRows(rows)).toEqual([
        expect.objectContaining({
          output: "Task tool failed",
          status: "error",
          toolName: tool,
        }),
      ]);
    },
  );

  it("suppresses the generic AskUserQuestion tool row in favor of the question row", () => {
    const rows = buildTimelineRows([
      turnStartedEvent({ seq: 0 }),
      toolCallItemEvent({
        seq: 1,
        tool: "AskUserQuestion",
        toolArgs: { questions: [{ question: "Which path?" }] },
        type: "item/started",
      }),
      toolCallItemEvent({
        result: "ok",
        seq: 2,
        tool: "AskUserQuestion",
        toolArgs: { questions: [{ question: "Which path?" }] },
        type: "item/completed",
      }),
    ]);

    expect(collectToolRows(rows)).toEqual([]);
  });

  it("extracts context-window usage from ordered events", () => {
    expect(
      buildContextWindowUsage([
        contextWindowUsageEvent({
          estimated: false,
          modelContextWindow: 200_000,
          seq: 1,
          usedTokens: 120,
        }),
        contextWindowUsageEvent({
          estimated: true,
          modelContextWindow: null,
          seq: 2,
          usedTokens: 60,
        }),
      ]),
    ).toEqual({
      estimated: true,
      modelContextWindow: 200_000,
      usedTokens: 60,
    });
  });

  it("extracts context-window usage from unordered events", () => {
    expect(
      buildContextWindowUsage([
        contextWindowUsageEvent({
          estimated: true,
          modelContextWindow: null,
          seq: 2,
          usedTokens: 60,
        }),
        contextWindowUsageEvent({
          estimated: false,
          modelContextWindow: 200_000,
          seq: 1,
          usedTokens: 120,
        }),
      ]),
    ).toEqual({
      estimated: true,
      modelContextWindow: 200_000,
      usedTokens: 60,
    });
  });

  it("keeps file-change row identity stable when provider changes reorder", () => {
    const initialChanges: ThreadEventFileChange[] = [
      {
        path: "src/a.ts",
        kind: "update",
        diff: "@@ -1 +1 @@\n-old a\n+new a",
      },
      {
        path: "src/b.ts",
        kind: "update",
        diff: "@@ -1 +1 @@\n-old b\n+new b",
      },
    ];
    const reorderedChanges = [initialChanges[1], initialChanges[0]].filter(
      (change): change is ThreadEventFileChange => Boolean(change),
    );
    const startedEvent = fileChangeItemEvent({
      changes: initialChanges,
      seq: 1,
      type: "item/started",
    });
    const turnStarted = turnStartedEvent({ seq: 0 });

    const initialRows = collectFileChangeRows(
      buildTimelineRows([turnStarted, startedEvent]),
    );
    const finalRows = collectFileChangeRows(
      buildTimelineRows([
        turnStarted,
        startedEvent,
        fileChangeItemEvent({
          changes: reorderedChanges,
          seq: 2,
          type: "item/completed",
        }),
      ]),
    );

    expect(fileChangeRowIdByPath(finalRows)).toEqual(
      fileChangeRowIdByPath(initialRows),
    );
  });

  it("drops stale file-change rows that are missing from later provider changes", () => {
    const startedEvent = fileChangeItemEvent({
      changes: [
        {
          path: "src/a.ts",
          kind: "update",
          diff: "@@ -1 +1 @@\n-old a\n+new a",
        },
        {
          path: "src/b.ts",
          kind: "update",
          diff: "@@ -1 +1 @@\n-old b\n+new b",
        },
      ],
      seq: 1,
      type: "item/started",
    });
    const turnStarted = turnStartedEvent({ seq: 0 });
    const finalRows = collectFileChangeRows(
      buildTimelineRows([
        turnStarted,
        startedEvent,
        fileChangeItemEvent({
          changes: [
            {
              path: "src/a.ts",
              kind: "update",
              diff: "@@ -1 +1 @@\n-old a\n+newer a",
            },
          ],
          seq: 2,
          type: "item/completed",
        }),
      ]),
    );

    expect(finalRows.map((row) => row.change.path)).toEqual(["src/a.ts"]);
  });

  it("keeps file-change row identity stable when movePath appears later", () => {
    const startedEvent = fileChangeItemEvent({
      changes: [
        {
          path: "src/old.ts",
          kind: "update",
          diff: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
      seq: 1,
      type: "item/started",
    });
    const turnStarted = turnStartedEvent({ seq: 0 });

    const initialRows = collectFileChangeRows(
      buildTimelineRows([turnStarted, startedEvent]),
    );
    const finalRows = collectFileChangeRows(
      buildTimelineRows([
        turnStarted,
        startedEvent,
        fileChangeItemEvent({
          changes: [
            {
              path: "src/old.ts",
              kind: "update",
              movePath: "src/new.ts",
              diff: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
          seq: 2,
          type: "item/completed",
        }),
      ]),
    );

    expect(finalRows).toHaveLength(1);
    expect(finalRows[0]?.id).toBe(initialRows[0]?.id);
    expect(finalRows[0]?.change).toMatchObject({
      path: "src/old.ts",
      movePath: "src/new.ts",
    });
  });

  it("relativizes absolute file-change paths against the workspace root", () => {
    const workspaceRoot = "/Users/dev/worktrees/env_x/bb";
    const rows = collectFileChangeRows(
      buildTimelineRows(
        [
          turnStartedEvent({ seq: 0 }),
          fileChangeItemEvent({
            changes: [
              {
                path: `${workspaceRoot}/src/old.ts`,
                kind: "update",
                movePath: `${workspaceRoot}/src/new.ts`,
                diff: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
            seq: 1,
            type: "item/completed",
          }),
        ],
        "idle",
        workspaceRoot,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.change).toMatchObject({
      path: "src/old.ts",
      movePath: "src/new.ts",
    });
  });

  it("leaves file-change paths outside the workspace root untouched", () => {
    const rows = collectFileChangeRows(
      buildTimelineRows(
        [
          turnStartedEvent({ seq: 0 }),
          fileChangeItemEvent({
            changes: [
              {
                path: "/etc/hosts",
                kind: "update",
                diff: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
            seq: 1,
            type: "item/completed",
          }),
        ],
        "idle",
        "/Users/dev/worktrees/env_x/bb",
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.change.path).toBe("/etc/hosts");
  });
});
