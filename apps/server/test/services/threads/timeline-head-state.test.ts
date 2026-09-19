import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { ClientTurnRequestId, Thread } from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  insertEvents,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import { buildThreadTimelineWithProfile } from "../../../src/services/threads/timeline.js";

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
  const db = createConnection(":memory:");
  migrate(db);
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

const baseOptions = {
  includeDiagnosticOperations: false,
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

    expect(unbudgeted.goal).not.toBeNull();
    expect(budgeted.goal).toEqual(unbudgeted.goal);

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
    expect(latest.response.goal?.objective).toBe("Land the timeline fix");
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
    expect(after.timelinePage.olderRowsSourceSeqEnd).toBeGreaterThan(
      before.maxSeq,
    );
    expect(after.pendingTodos).toEqual(before.pendingTodos);
    expect(after.goal).toEqual(before.goal);
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
    expect(budgeted.goal).toBeNull();
    expect(budgeted.activeWorkflows).toHaveLength(0);
  });
});
