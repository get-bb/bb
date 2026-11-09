import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  THREAD_PROVIDER_COMMANDS_STATE_KIND,
  THREAD_SESSION_OPTIONS_STATE_KIND,
  THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { ClientTurnRequestId, Thread } from "@bb/domain";
import {
  createProject,
  createThread,
  getLatestThreadSequence,
  insertEvents,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import type { DbConnection } from "@bb/db";
import { buildThreadTimelineWithProfile } from "../../../src/services/threads/timeline.js";
import { readThreadHeadState } from "../../../src/services/threads/thread-head-state.js";

const providerThreadId = "provider-root";
const execution = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;

const requestId = (value: number): ClientTurnRequestId =>
  encodeClientTurnRequestIdNumber({ value });

function setup(): { db: DbConnection; thread: Thread } {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "claude-code",
    status: "active",
  });
  return { db, thread };
}

function seedThreadWithEarlyHeadState(
  db: DbConnection,
  thread: Thread,
  turns: number,
  itemsPerTurn: number,
  runningWorkflow: boolean,
  pendingCommand = false,
): void {
  const events: Parameters<typeof insertEvents>[2] = [];
  let sequence = 0;
  for (let turn = 1; turn <= turns; turn += 1) {
    const turnId = `turn-${turn}`;
    const clientRequestId = requestId(turn);
    events.push({
      threadId: thread.id,
      sequence: (sequence += 1),
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: clientRequestId,
        senderThreadId: null,
        input: [{ type: "text", text: `Message ${turn}`, mentions: [] }],
        target: turn === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
        execution,
      }),
    });
    events.push({
      threadId: thread.id,
      sequence: (sequence += 1),
      type: "turn/started",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({}),
    });
    events.push({
      threadId: thread.id,
      sequence: (sequence += 1),
      type: "turn/input/accepted",
      scope: turnScope(turnId),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ clientRequestId }),
    });

    if (turn === 1) {
      events.push({
        threadId: thread.id,
        sequence: (sequence += 1),
        type: "thread/goal/updated",
        scope: threadScope(),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        data: JSON.stringify({
          threadId: thread.id,
          providerThreadId,
          objective: "Land the timeline fix",
          status: "active",
          tokenBudget: null,
          tokensUsed: 120,
          timeUsedSeconds: 45,
        }),
      });
      events.push({
        threadId: thread.id,
        sequence: (sequence += 1),
        type: "item/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: "plan-1",
        itemKind: "planSteps",
        parentToolCallId: null,
        data: JSON.stringify({
          providerThreadId,
          item: {
            type: "planSteps",
            id: "plan-1",
            steps: [
              { step: "Shipping the thing", status: "active" },
              { step: "Write the docs", status: "pending" },
            ],
            status: "completed",
          },
        }),
      });
      if (pendingCommand) {
        events.push({
          threadId: thread.id,
          sequence: (sequence += 1),
          type: "item/started",
          scope: turnScope(turnId),
          providerThreadId,
          itemId: "old-command",
          itemKind: "commandExecution",
          parentToolCallId: null,
          data: JSON.stringify({
            item: {
              type: "commandExecution",
              id: "old-command",
              command: "echo done",
              cwd: "/tmp",
              status: "pending",
              aggregatedOutput: "",
              approvalStatus: null,
            },
          }),
        });
      }
      if (runningWorkflow)
        events.push({
          threadId: thread.id,
          sequence: (sequence += 1),
          type: "item/started",
          scope: turnScope(turnId),
          providerThreadId,
          itemId: "wf-1",
          itemKind: "backgroundTask",
          parentToolCallId: null,
          data: JSON.stringify({
            providerThreadId,
            item: {
              id: "wf-1",
              type: "backgroundTask",
              taskType: "local_workflow",
              description: "long running workflow",
              status: "pending",
              taskStatus: "running",
              skipTranscript: false,
              foreground: false,
              workflowName: "fixture-mini",
              usage: { totalTokens: 100, toolUses: 2, durationMs: 1500 },
            },
          }),
        });
    }

    for (let item = 0; item < itemsPerTurn; item += 1) {
      events.push({
        threadId: thread.id,
        sequence: (sequence += 1),
        type: "item/completed",
        scope: turnScope(turnId),
        providerThreadId,
        itemId: `${turnId}-item-${item}`,
        itemKind: "agentMessage",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "agentMessage",
            id: `${turnId}-item-${item}`,
            text: `Turn ${turn} item ${item}`,
          },
        }),
      });
    }
  }
  insertEvents(db, noopNotifier, events);
}

const CODEX_GOAL_KIND = "provider-codex/goal";

const baseOptions = {
  extensionStateKinds: [CODEX_GOAL_KIND],
  includeClearedContextHistory: false,
  includeDiagnosticOperations: false,
  compactionOfferEnabled: false,
  summarizeShellCommands: true,
  includeNestedRows: true,
  maxInlineOutputChars: null,
  maxSeq: 0,
  page: { kind: "latest", segmentLimit: 20 } as const,
};

describe("timeline head state under a budgeted window", () => {
  it("keeps goal, todos, and a running workflow when the budget excludes the turn that set them", () => {
    const { db, thread } = setup();
    seedThreadWithEarlyHeadState(db, thread, 12, 60, true);

    const unbudgeted = buildThreadTimelineWithProfile(db, thread, {
      completedTurnDisplay: "collapse",
      ...baseOptions,
      eventBudget: 1_000_000,
    }).response;
    const budgeted = buildThreadTimelineWithProfile(db, thread, {
      completedTurnDisplay: "collapse",
      ...baseOptions,
      eventBudget: 100,
    }).response;

    expect(budgeted.timelinePage.returnedSegmentCount).toBeLessThan(
      unbudgeted.timelinePage.returnedSegmentCount,
    );

    expect(unbudgeted.pendingTodos?.items.map((item) => item.text)).toContain(
      "Shipping the thing",
    );
    expect(budgeted.pendingTodos?.items.map((item) => item.text)).toContain(
      "Shipping the thing",
    );

    expect(unbudgeted.extensionStates[CODEX_GOAL_KIND]).toBeDefined();
    expect(budgeted.extensionStates).toEqual(unbudgeted.extensionStates);

    expect(unbudgeted.activeWorkflows).toHaveLength(1);
    expect(budgeted.activeWorkflows).toHaveLength(1);
  });

  it("keeps historical plan state without loading intervening conversation markers", () => {
    const { db, thread } = setup();
    seedThreadWithEarlyHeadState(db, thread, 100, 1, false);
    const latest = buildThreadTimelineWithProfile(db, thread, {
      ...baseOptions,
      completedTurnDisplay: "collapse",
      eventBudget: 8,
      page: { kind: "latest", segmentLimit: 2 },
    });
    expect(
      latest.response.pendingTodos?.items.map((item) => item.text),
    ).toEqual(["Shipping the thing", "Write the docs"]);
    expect(latest.response.extensionStates[CODEX_GOAL_KIND]).toMatchObject({
      objective: "Land the timeline fix",
    });
    expect(latest.response.rows.some((row) => row.sourceSeqStart < 390)).toBe(
      false,
    );
    expect(latest.profile.eventRowCount).toBeLessThan(20);
    db.$client.close();
  });

  it("still marks an omitted older message changed by a late completion", () => {
    const { db, thread } = setup();
    seedThreadWithEarlyHeadState(db, thread, 100, 1, false, true);
    const options = {
      ...baseOptions,
      completedTurnDisplay: "collapse" as const,
      eventBudget: 8,
      page: { kind: "latest" as const, segmentLimit: 2 },
    };
    const before = buildThreadTimelineWithProfile(db, thread, options).response;
    insertEvents(db, noopNotifier, [
      {
        threadId: thread.id,
        sequence: before.maxSeq + 1,
        type: "item/completed",
        scope: turnScope("turn-1"),
        providerThreadId,
        itemId: "old-command",
        itemKind: "commandExecution",
        parentToolCallId: null,
        data: JSON.stringify({
          item: {
            type: "commandExecution",
            id: "old-command",
            command: "echo done",
            cwd: "/tmp",
            status: "completed",
            aggregatedOutput: "done",
            approvalStatus: null,
            exitCode: 0,
            durationMs: 1000,
          },
        }),
      },
    ]);
    const after = buildThreadTimelineWithProfile(db, thread, options).response;
    expect(
      after.timelinePage.olderRowUpdates?.map((row) => row.sourceSeqEnd),
    ).toContain(before.maxSeq + 1);
    expect(after.pendingTodos).toEqual(before.pendingTodos);
    expect(after.extensionStates).toEqual(before.extensionStates);
    db.$client.close();
  });

  it("still reports no head state when the thread never set any", () => {
    const { db, thread } = setup();
    const events: Parameters<typeof insertEvents>[2] = [];
    events.push({
      threadId: thread.id,
      sequence: 1,
      type: "client/turn/requested",
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: requestId(1),
        senderThreadId: null,
        input: [{ type: "text", text: "hello", mentions: [] }],
        target: { kind: "thread-start" },
        execution,
      }),
    });
    insertEvents(db, noopNotifier, events);

    const budgeted = buildThreadTimelineWithProfile(db, thread, {
      completedTurnDisplay: "collapse",
      ...baseOptions,
      eventBudget: 100,
    }).response;
    expect(budgeted.pendingTodos).toBeNull();
    expect(budgeted.extensionStates).toEqual({});
    expect(budgeted.activeWorkflows).toHaveLength(0);
  });
});

function insertExtensionState(
  db: DbConnection,
  thread: Thread,
  kind: string,
  payload: unknown,
): void {
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: getLatestThreadSequence(db, { threadId: thread.id }) + 1,
      type: "thread/extensionState/updated",
      scope: threadScope(),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({ kind, payload }),
    },
  ]);
}

function insertAgentMessages(
  db: DbConnection,
  thread: Thread,
  count: number,
): void {
  const start = getLatestThreadSequence(db, { threadId: thread.id });
  insertEvents(
    db,
    noopNotifier,
    Array.from({ length: count }, (_, index) => ({
      threadId: thread.id,
      sequence: start + index + 1,
      type: "item/completed" as const,
      scope: turnScope("turn-1"),
      providerThreadId,
      itemId: `late-item-${index}`,
      itemKind: "agentMessage" as const,
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "agentMessage",
          id: `late-item-${index}`,
          text: `Late item ${index}`,
        },
      }),
    })),
  );
}

const headStateOptions = {
  compactionOfferEnabled: false,
  extensionStateKinds: [CODEX_GOAL_KIND],
  planCommand: null,
} as const;

function insertThreadEvent(
  db: DbConnection,
  thread: Thread,
  type: "client/turn/requested" | "provider/modelFallback",
  data: Record<string, unknown>,
): void {
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: getLatestThreadSequence(db, { threadId: thread.id }) + 1,
      type,
      scope:
        type === "provider/modelFallback" ? turnScope("turn-1") : threadScope(),
      providerThreadId,
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify(data),
    },
  ]);
}

describe("readThreadHeadState", () => {
  function seedHeadState(db: DbConnection, thread: Thread): void {
    seedThreadWithEarlyHeadState(db, thread, 1, 0, false);
    insertExtensionState(db, thread, THREAD_PROVIDER_COMMANDS_STATE_KIND, {
      commands: [{ name: "stale", description: "Replaced later" }],
    });
    insertExtensionState(db, thread, THREAD_SESSION_OPTIONS_STATE_KIND, {
      options: [
        {
          id: "effort",
          label: "Effort",
          type: "select",
          value: "medium",
          values: [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
        },
      ],
    });
    insertExtensionState(
      db,
      thread,
      THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
      { selections: { effort: "high" } },
    );
    insertExtensionState(db, thread, THREAD_PROVIDER_COMMANDS_STATE_KIND, {
      commands: [
        { name: "review", description: "Review changes", inputHint: "[path]" },
      ],
    });
    insertAgentMessages(db, thread, 800);
  }

  it("reads the latest state far behind a long turn", () => {
    const { db, thread } = setup();
    seedHeadState(db, thread);

    const headState = readThreadHeadState(db, thread, headStateOptions);

    expect(headState.pendingTodos?.items.map((item) => item.text)).toEqual([
      "Shipping the thing",
      "Write the docs",
    ]);
    expect(headState.providerCommands?.map((command) => command.name)).toEqual([
      "review",
    ]);
    expect(headState.sessionOptions).toMatchObject([
      { id: "effort", value: "medium", pendingValue: "high" },
    ]);
    expect(headState.extensionStates[CODEX_GOAL_KIND]).toMatchObject({
      objective: "Land the timeline fix",
    });
    expect(
      readThreadHeadState(db, thread, {
        ...headStateOptions,
        extensionStateKinds: [],
      }).extensionStates,
    ).toEqual({});
    db.$client.close();
  });

  it("reports a model fallback until the next turn is requested", () => {
    const { db, thread } = setup();
    seedThreadWithEarlyHeadState(db, thread, 1, 0, false);
    insertThreadEvent(db, thread, "provider/modelFallback", {
      threadId: thread.id,
      providerThreadId,
      originalModel: "opus",
      fallbackModel: "sonnet",
      reason: "provider",
      message: "Switched to sonnet.",
    });
    insertAgentMessages(db, thread, 50);

    expect(
      readThreadHeadState(db, thread, headStateOptions).modelFallback,
    ).toMatchObject({ originalModel: "opus", fallbackModel: "sonnet" });

    insertThreadEvent(db, thread, "client/turn/requested", {
      direction: "outbound",
      source: "tell",
      initiator: "user",
      request: { method: "turn/start", params: {} },
      requestId: requestId(2),
      senderThreadId: null,
      input: [{ type: "text", text: "Next", mentions: [] }],
      target: { kind: "new-turn" },
      execution,
    });

    expect(
      readThreadHeadState(db, thread, headStateOptions).modelFallback,
    ).toBeNull();
    db.$client.close();
  });

  it("reports no todos once the thread is no longer active", () => {
    const { db, thread } = setup();
    seedHeadState(db, thread);
    const headState = readThreadHeadState(
      db,
      { ...thread, status: "idle" },
      headStateOptions,
    );

    expect(headState.pendingTodos).toBeNull();
    expect(headState.providerCommands).not.toBeNull();
    db.$client.close();
  });
});
