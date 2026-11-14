import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  LOCAL_WORKFLOW_TASK_TYPE,
  type ThreadEventItemType,
} from "@bb/domain";
import {
  createThread,
  deleteThreadEventSuffixInTransaction,
  getLatestThreadSequence,
  noopNotifier,
} from "@bb/db";
import { parseStoredEvent } from "../../../src/services/threads/thread-data.js";
import {
  forgetTimelineProjection,
  listTimelineProjections,
  MAX_TIMELINE_PROJECTION_DATA_BYTES,
  peekTimelineProjection,
} from "../../../src/services/threads/timeline-projection.js";
import { createTestProviderRegistry } from "../../helpers/provider-registry.js";
import {
  appendRows as append,
  PROVIDER_THREAD_ID as providerThreadId,
  withTestThread,
  type RowSpec,
  type TestThread,
} from "../../helpers/timeline-cache-fixture.js";
import {
  buildRouteTimelinePage,
  clearCrossBuildTimelineCaches,
} from "../../provider-corpus/corpus-harness.js";

const registry = await createTestProviderRegistry();

function turnRows(index: number, close: boolean): RowSpec[] {
  const turnId = `turn-${index}`;
  const requestId = encodeClientTurnRequestIdNumber({ value: index });
  return [
    {
      data: {
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId,
        senderThreadId: null,
        input: [{ type: "text", text: `User ${index}`, mentions: [] }],
        target: index === 1 ? { kind: "thread-start" } : { kind: "new-turn" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
      },
      type: "client/turn/requested",
    },
    { data: {}, turnId, type: "turn/started" },
    {
      data: { clientRequestId: requestId },
      turnId,
      type: "turn/input/accepted",
    },
    {
      data: {
        item: { id: `message-${index}`, text: "", type: "agentMessage" },
      },
      itemId: `message-${index}`,
      itemKind: "agentMessage",
      turnId,
      type: "item/started",
    },
    ...(close
      ? [
          {
            data: { status: "completed" },
            turnId,
            type: "turn/completed",
          } as const,
        ]
      : []),
  ];
}

function itemRow(
  type: "item/started" | "item/completed",
  turnId: string,
  item: Record<string, unknown> & { id: string; type: ThreadEventItemType },
): RowSpec {
  return { data: { item }, itemId: item.id, itemKind: item.type, turnId, type };
}

function message(turnId: string, id: string, text: string): RowSpec {
  return itemRow("item/completed", turnId, { id, text, type: "agentMessage" });
}

function turnWithMessages(index: number, texts: readonly string[]): RowSpec[] {
  const turnId = `turn-${index}`;
  return [
    ...turnRows(index, false),
    ...texts.map((text, offset) =>
      message(turnId, `message-${index}-${offset}`, text),
    ),
    { data: { status: "completed" }, turnId, type: "turn/completed" },
  ];
}

function goalRow(threadId: string, objective: string): RowSpec {
  return {
    data: {
      threadId,
      providerThreadId,
      objective,
      status: "active",
      tokenBudget: null,
      tokensUsed: 1,
      timeUsedSeconds: 1,
    },
    providerThreadId,
    type: "thread/goal/updated",
  };
}

function planStepsRow(turnId: string, id: string, step: string): RowSpec {
  return itemRow("item/completed", turnId, {
    type: "planSteps",
    id,
    steps: [
      { step, status: "active" },
      { step: `${step} docs`, status: "pending" },
    ],
    status: "completed",
  });
}

function workflowTask(id: string, completed: boolean) {
  return {
    description: "workflow",
    id,
    skipTranscript: false,
    foreground: false,
    status: completed ? "completed" : "pending",
    taskStatus: completed ? "completed" : "running",
    taskType: LOCAL_WORKFLOW_TASK_TYPE,
    type: "backgroundTask",
    workflowName: "workflow",
  } as const;
}

function read(
  testThread: Pick<TestThread, "db" | "thread">,
  args: { maxSeq?: number; segmentLimit?: number } = {},
) {
  return buildRouteTimelinePage({
    db: testThread.db,
    eventBudget: 200,
    extensionStateKinds: ["provider-codex/goal"],
    includeDiagnosticOperations: false,
    ...(args.maxSeq === undefined ? {} : { maxSeq: args.maxSeq }),
    page: { kind: "latest", segmentLimit: args.segmentLimit ?? 1 },
    registry,
    thread: testThread.thread,
    variant: "default",
  });
}

describe("timeline projection reuse", () => {
  it("builds a read pinned below the head as a cold read does, after the head moved", () => {
    withTestThread((testThread) => {
      const pinned = append(testThread, [
        ...turnRows(1, false),
        goalRow(testThread.thread.id, "first goal"),
        planStepsRow("turn-1", "plan-1", "Ship it"),
        itemRow("item/started", "turn-1", workflowTask("task:wf-1", false)),
        message("turn-1", "message-1", "one"),
      ]);
      read(testThread);
      append(testThread, [
        goalRow(testThread.thread.id, "second goal"),
        planStepsRow("turn-1", "plan-2", "Ship again"),
        {
          data: { item: workflowTask("task:wf-1", true) },
          itemId: "task:wf-1",
          itemKind: "backgroundTask",
          providerThreadId,
          type: "item/backgroundTask/completed",
        },
      ]);
      const warm = read(testThread, { maxSeq: pinned });
      clearCrossBuildTimelineCaches(testThread.coldDb);
      const cold = buildRouteTimelinePage({
        db: testThread.coldDb,
        eventBudget: 200,
        extensionStateKinds: ["provider-codex/goal"],
        includeDiagnosticOperations: false,
        maxSeq: pinned,
        page: { kind: "latest", segmentLimit: 1 },
        registry,
        thread: testThread.thread,
        variant: "default",
      });
      expect(warm.response).toEqual(cold.response);
    });
  });

  it("reuses the unchanged decoded rows after a rewrite and drops them when the thread is deleted", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      append(testThread, turnWithMessages(1, ["one", "two"]));
      read(testThread);
      const before = peekTimelineProjection(db, thread.id)!;
      const latest = getLatestThreadSequence(db, { threadId: thread.id });
      db.transaction((tx) => {
        deleteThreadEventSuffixInTransaction(tx, {
          cutoffSequence: latest,
          oldMaxSequence: latest,
          threadId: thread.id,
        });
      });
      append(testThread, [
        message("turn-1", "message-1-2", "three"),
        {
          data: { status: "completed" },
          turnId: "turn-1",
          type: "turn/completed",
        },
      ]);
      read(testThread);
      const after = peekTimelineProjection(db, thread.id)!;
      expect(after).not.toBe(before);
      const beforeById = new Map(
        before.events.map((event) => [event.meta.id, event]),
      );
      for (const [index, row] of after.selection.rows.entries()) {
        const event = after.events[index]!;
        expect(event.event).toEqual(parseStoredEvent(row));
        if (row.sequence < latest) {
          expect(event).toBe(beforeById.get(row.id));
        }
      }

      forgetTimelineProjection(db, thread.id);
      expect(listTimelineProjections(db)).toEqual([]);
    });
  });

  it("keeps an older page's decoded rows for the next build of that page", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      append(testThread, [
        ...turnWithMessages(1, ["a", "b"]),
        ...turnWithMessages(2, ["c", "d"]),
        ...turnWithMessages(3, ["e", "f"]),
      ]);
      const latest = read(testThread);
      const older = () =>
        buildRouteTimelinePage({
          db,
          eventBudget: 200,
          extensionStateKinds: ["provider-codex/goal"],
          includeDiagnosticOperations: false,
          page: {
            kind: "older",
            beforeCursor: latest.response.timelinePage.olderCursor!,
            segmentLimit: 1,
          },
          registry,
          thread,
          variant: "default",
        });
      older();
      const projection = peekTimelineProjection(db, thread.id)!;
      const windowIds = new Set(projection.selection.rows.map((row) => row.id));
      const kept = new Map(
        [...projection.releasedEvents].filter(([id]) => !windowIds.has(id)),
      );
      expect(kept.size).toBeGreaterThan(0);
      for (const { event, row } of kept.values()) {
        expect(event.event).toEqual(parseStoredEvent(row));
      }
      older();
      for (const [id, entry] of kept) {
        expect(projection.releasedEvents.get(id)?.event).toBe(entry.event);
      }
    });
  });

  it("drops released rows before another thread's window when over the budget", () => {
    withTestThread((testThread) => {
      const rowChars = 1_000_000;
      const big = (count: number) =>
        Array.from({ length: count }, () => "x".repeat(rowChars));
      const small = {
        db: testThread.db,
        thread: createThread(testThread.db, noopNotifier, {
          projectId: testThread.projectId,
          providerId: "codex",
          status: "active",
        }),
      };
      append(small, turnWithMessages(1, ["small"]));
      read(small);
      append(testThread, turnWithMessages(1, big(6)));
      read(testThread);
      append(testThread, turnWithMessages(2, big(11)));
      read(testThread);
      const large = peekTimelineProjection(
        testThread.db,
        testThread.thread.id,
      )!;
      expect(large.dataBytes).toBeGreaterThan(10 * rowChars);
      expect(
        peekTimelineProjection(testThread.db, small.thread.id),
      ).toBeDefined();
      const retained = listTimelineProjections(testThread.db).reduce(
        (total, projection) =>
          total +
          projection.dataBytes +
          projection.releasedBytes +
          projection.derivedBytes,
        0,
      );
      expect(retained).toBeLessThanOrEqual(MAX_TIMELINE_PROJECTION_DATA_BYTES);
    });
  }, 60_000);
});
