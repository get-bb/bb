import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  type ThreadEventItemType,
} from "@bb/domain";
import {
  getLatestThreadSequence,
  listStoredTimelineRangeEventRows,
  listTimelineProgressedBackgroundTaskItemIds,
} from "@bb/db";
import { parseStoredEvent } from "../../../src/services/threads/thread-data.js";
import {
  findTimelineUnitCuts,
  type TimelineUnitEvent,
} from "../../../src/services/threads/timeline-units.js";
import {
  appendRows,
  PROVIDER_THREAD_ID,
  withTestThread,
  type RowSpec,
  type TestThread,
} from "../../helpers/timeline-cache-fixture.js";

function request(value: number): RowSpec {
  return {
    data: {
      direction: "outbound",
      source: "tell",
      initiator: "user",
      request: { method: "turn/start", params: {} },
      requestId: encodeClientTurnRequestIdNumber({ value }),
      senderThreadId: null,
      input: [{ type: "text", text: `Message ${value}`, mentions: [] }],
      target: value === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
    },
    type: "client/turn/requested",
  };
}

function startTurn(value: number): RowSpec[] {
  const turnId = `turn-${value}`;
  return [
    request(value),
    { data: {}, turnId, type: "turn/started" },
    {
      data: { clientRequestId: encodeClientTurnRequestIdNumber({ value }) },
      turnId,
      type: "turn/input/accepted",
    },
  ];
}

function completeTurn(value: number): RowSpec {
  return {
    data: { status: "completed" },
    turnId: `turn-${value}`,
    type: "turn/completed",
  };
}

function item(
  type: "item/started" | "item/completed",
  turnId: string,
  body: Record<string, unknown> & { id: string; type: ThreadEventItemType },
  parentToolCallId: string | null = null,
): RowSpec {
  return {
    data: { item: body },
    itemId: body.id,
    itemKind: body.type,
    parentToolCallId,
    turnId,
    type,
  };
}

function reasoning(turnId: string, id: string): RowSpec[] {
  return [
    item("item/started", turnId, {
      id,
      type: "reasoning",
      summary: [],
      content: [],
    }),
    item("item/completed", turnId, {
      id,
      type: "reasoning",
      summary: ["Thinking"],
      content: [],
    }),
  ];
}

function backgroundTaskItem(id: string, running: boolean) {
  return {
    description: "background",
    foreground: false,
    id,
    skipTranscript: false,
    status: running ? "pending" : "completed",
    taskStatus: running ? "running" : "completed",
    taskType: "local_bash",
    type: "backgroundTask" as const,
  };
}

function backgroundTaskStarted(turnId: string, id: string): RowSpec {
  return item("item/started", turnId, backgroundTaskItem(id, true));
}

function backgroundTaskUpdate(
  type: "item/backgroundTask/progress" | "item/backgroundTask/completed",
  id: string,
): RowSpec {
  return {
    data: {
      item: backgroundTaskItem(id, type === "item/backgroundTask/progress"),
    },
    itemId: id,
    itemKind: "backgroundTask",
    providerThreadId: PROVIDER_THREAD_ID,
    turnId: null,
    type,
  };
}

function command(
  turnId: string,
  id: string,
  parentToolCallId: string | null = null,
) {
  return item(
    "item/completed",
    turnId,
    {
      aggregatedOutput: "ok\n",
      approvalStatus: null,
      command: "true",
      cwd: "/tmp",
      exitCode: 0,
      id,
      status: "completed",
      type: "commandExecution",
    },
    parentToolCallId,
  );
}

function readUnits(testThread: TestThread): TimelineUnitEvent[] {
  return listStoredTimelineRangeEventRows(testThread.db, {
    afterSequence: 0,
    excludeDiagnosticEvents: true,
    excludedTypes: [],
    maxInlineOutputChars: null,
    threadId: testThread.thread.id,
    throughSequence: getLatestThreadSequence(testThread.db, {
      threadId: testThread.thread.id,
    }),
  }).map((row) => ({ event: parseStoredEvent(row), row }));
}

function cutSequences(testThread: TestThread): number[] {
  const units = readUnits(testThread);
  const progressed = new Set(
    listTimelineProgressedBackgroundTaskItemIds(testThread.db, {
      sequenceStart: 0,
      threadId: testThread.thread.id,
      throughSequence: getLatestThreadSequence(testThread.db, {
        threadId: testThread.thread.id,
      }),
    }),
  );
  return findTimelineUnitCuts(units, progressed).map(
    (index) => units[index]!.row.sequence,
  );
}

describe("timeline unit cuts", () => {
  it("cuts before each request that follows a completed turn", () => {
    withTestThread((testThread) => {
      appendRows(testThread, [
        ...startTurn(1),
        command("turn-1", "command-1"),
        completeTurn(1),
      ]);
      const secondRequest = appendRows(testThread, [request(2)]);
      appendRows(testThread, [
        { data: {}, turnId: "turn-2", type: "turn/started" },
        {
          data: {
            clientRequestId: encodeClientTurnRequestIdNumber({ value: 2 }),
          },
          turnId: "turn-2",
          type: "turn/input/accepted",
        },
        command("turn-2", "command-2"),
      ]);

      expect(cutSequences(testThread)).toEqual([secondRequest]);
    });
  });

  it("cuts after a turn whose background task is still running", () => {
    withTestThread((testThread) => {
      appendRows(testThread, [
        ...startTurn(1),
        backgroundTaskStarted("turn-1", "task-1"),
        completeTurn(1),
      ]);
      const secondRequest = appendRows(testThread, [request(2)]);
      appendRows(testThread, [
        ...startTurn(2).slice(1),
        completeTurn(2),
        backgroundTaskUpdate("item/backgroundTask/completed", "task-1"),
      ]);
      const thirdRequest = appendRows(testThread, [request(3)]);

      expect(cutSequences(testThread)).toEqual([secondRequest, thirdRequest]);
    });
  });

  it("keeps a background task that reports progress joined until it completes", () => {
    withTestThread((testThread) => {
      appendRows(testThread, [
        ...startTurn(1),
        backgroundTaskStarted("turn-1", "task-1"),
        completeTurn(1),
        ...startTurn(2),
        backgroundTaskUpdate("item/backgroundTask/progress", "task-1"),
        completeTurn(2),
        backgroundTaskUpdate("item/backgroundTask/completed", "task-1"),
      ]);
      const thirdRequest = appendRows(testThread, [request(3)]);

      expect(cutSequences(testThread)).toEqual([thirdRequest]);
    });
  });

  it("does not cut between a delegation and a later child event that refers to it", () => {
    withTestThread((testThread) => {
      appendRows(testThread, [
        ...startTurn(1),
        item("item/completed", "turn-1", {
          arguments: { prompt: "Investigate" },
          id: "agent-1",
          result: "done",
          status: "completed",
          tool: "Agent",
          type: "toolCall",
        }),
        completeTurn(1),
        ...startTurn(2),
        command("turn-2", "child-command", "agent-1"),
        completeTurn(2),
      ]);

      expect(cutSequences(testThread)).toEqual([]);
    });
  });

  it("lets later turns reuse a reasoning item id", () => {
    withTestThread((testThread) => {
      appendRows(testThread, [
        ...startTurn(1),
        ...reasoning("turn-1", "reasoning-1"),
        completeTurn(1),
      ]);
      const secondRequest = appendRows(testThread, [request(2)]);
      appendRows(testThread, [
        { data: {}, turnId: "turn-2", type: "turn/started" },
        {
          data: {
            clientRequestId: encodeClientTurnRequestIdNumber({ value: 2 }),
          },
          turnId: "turn-2",
          type: "turn/input/accepted",
        },
        ...reasoning("turn-2", "reasoning-1"),
      ]);

      expect(cutSequences(testThread)).toEqual([secondRequest]);
    });
  });
});
