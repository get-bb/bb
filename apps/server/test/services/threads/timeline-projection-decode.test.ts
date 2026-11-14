import { describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  type ThreadEventItemType,
} from "@bb/domain";
import {
  createThread,
  deleteThreadEventSuffixInTransaction,
  getLatestThreadSequence,
  listStoredEventRows,
  noopNotifier,
  type DbConnection,
} from "@bb/db";
import { parseStoredEvent } from "../../../src/services/threads/thread-data.js";
import {
  decodeStoredEventRow,
  forgetTimelineProjection,
  listTimelineProjections,
  MAX_TIMELINE_PROJECTION_DATA_BYTES,
  MAX_TIMELINE_PROJECTIONS,
} from "../../../src/services/threads/timeline-projection.js";
import { createTestProviderRegistry } from "../../helpers/provider-registry.js";
import {
  appendRows,
  withTestThread,
  type RowSpec,
  type TestThread,
} from "../../helpers/timeline-cache-fixture.js";
import {
  buildRouteTimelinePage,
  selectionWasReused,
} from "../../provider-corpus/corpus-harness.js";

const registry = await createTestProviderRegistry();

function itemRow(
  type: "item/started" | "item/completed",
  item: Record<string, unknown> & { id: string; type: ThreadEventItemType },
): RowSpec {
  return {
    data: { item },
    itemId: item.id,
    itemKind: item.type,
    turnId: "turn-1",
    type,
  };
}

function agentMessage(id: string, text: string): RowSpec {
  return itemRow("item/completed", { id, text, type: "agentMessage" });
}

function openTurn(): RowSpec[] {
  return [
    {
      data: {
        direction: "outbound",
        source: "tell",
        initiator: "user",
        request: { method: "turn/start", params: {} },
        requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
        senderThreadId: null,
        input: [{ type: "text", text: "Hello", mentions: [] }],
        target: { kind: "thread-start" },
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
    { data: {}, turnId: "turn-1", type: "turn/started" },
    {
      data: {
        clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
      },
      turnId: "turn-1",
      type: "turn/input/accepted",
    },
    itemRow("item/started", {
      id: "message-1",
      text: "",
      type: "agentMessage",
    }),
  ];
}

function messageDelta(delta: string): RowSpec {
  return {
    data: { itemId: "message-1", delta },
    itemId: "message-1",
    turnId: "turn-1",
    type: "item/agentMessage/delta",
  };
}

function buildLatest(testThread: Pick<TestThread, "db" | "thread">) {
  return buildRouteTimelinePage({
    db: testThread.db,
    eventBudget: 200,
    includeDiagnosticOperations: false,
    page: { kind: "latest", segmentLimit: 3 },
    registry,
    thread: testThread.thread,
    variant: "default",
  });
}

function projectionsOf(db: DbConnection, threadId: string) {
  return listTimelineProjections(db).filter(
    (projection) => projection.scope.threadId === threadId,
  );
}

function retainedDataBytes(db: DbConnection): number {
  return listTimelineProjections(db).reduce(
    (sum, projection) => sum + projection.dataBytes,
    0,
  );
}

function retainedBytes(db: DbConnection): number {
  return listTimelineProjections(db).reduce(
    (sum, projection) =>
      sum +
      projection.dataBytes +
      projection.releasedBytes +
      projection.derivedBytes,
    0,
  );
}

function sharedRowIds(
  previous: { response: { rows: readonly object[] } },
  next: { response: { rows: readonly { id: string }[] } },
): string[] {
  const previousRows = new Set(previous.response.rows);
  return next.response.rows
    .filter((row) => previousRows.has(row))
    .map((row) => row.id);
}

function addActiveThread(testThread: TestThread) {
  return {
    db: testThread.db,
    thread: createThread(testThread.db, noopNotifier, {
      projectId: testThread.projectId,
      providerId: "codex",
      status: "active",
    }),
  };
}

function userTurn(index: number): RowSpec[] {
  const turnId = `turn-${index}`;
  const requestId = encodeClientTurnRequestIdNumber({ value: index });
  const [request] = openTurn();
  return [
    {
      ...request!,
      data: {
        ...request!.data,
        requestId,
        target: { kind: "new-turn" },
        input: [{ type: "text", text: `Turn ${index}`, mentions: [] }],
      },
    },
    { data: {}, turnId, type: "turn/started" },
    {
      data: { clientRequestId: requestId },
      turnId,
      type: "turn/input/accepted",
    },
    { ...agentMessage(`message-${turnId}`, `Reply ${index}`), turnId },
    { data: { status: "completed" }, turnId, type: "turn/completed" },
  ];
}

describe("timeline projection decoding", () => {
  it("decodes each row once and keeps the decoded events across appends", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      appendRows(testThread, openTurn());
      buildLatest(testThread);
      const [first] = projectionsOf(db, thread.id);
      expect(first).toBeDefined();
      const decoded = [...first!.events];
      appendRows(testThread, [messageDelta("one"), messageDelta("Héllo")]);
      const warm = buildLatest(testThread);
      expect(selectionWasReused(warm.profile)).toBe(true);
      const [after] = projectionsOf(db, thread.id);
      expect(after).toBe(first);
      expect(after!.events).toHaveLength(decoded.length + 2);
      for (const [index, event] of decoded.entries()) {
        expect(after!.events[index]).toBe(event);
      }
      expect(after!.events).toEqual(
        after!.selection.rows.map((row) => ({
          event: parseStoredEvent(row),
          meta: { id: row.id, seq: row.sequence, createdAt: row.createdAt },
        })),
      );
      expect(after!.dataBytes).toBe(
        after!.selection.rows.reduce(
          (sum, row) => sum + Buffer.byteLength(row.data, "utf8"),
          0,
        ),
      );
      expect(warm.profile.eventDataBytes).toBe(after!.dataBytes);
    });
  });

  it("freezes decoded events while the server suite enables the test seam", () => {
    withTestThread((testThread) => {
      appendRows(testThread, openTurn());
      buildLatest(testThread);
      const [projection] = projectionsOf(testThread.db, testThread.thread.id);
      const row = projection!.selection.rows.at(-1)!;
      const { event } = decodeStoredEventRow(row);
      expect(Object.isFrozen(event)).toBe(true);
      expect(Object.isFrozen(projection!.events.at(-1)!.event)).toBe(true);
    });
  });

  it("forgets decoded rows when the thread is forgotten or its history rewritten", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      appendRows(testThread, [...openTurn(), messageDelta("one")]);
      buildLatest(testThread);
      const [before] = projectionsOf(db, thread.id);
      const maxSeq = getLatestThreadSequence(db, { threadId: thread.id });
      db.transaction((tx) => {
        deleteThreadEventSuffixInTransaction(tx, {
          cutoffSequence: maxSeq,
          oldMaxSequence: maxSeq,
          threadId: thread.id,
        });
      });
      appendRows(testThread, [messageDelta("two")]);
      const rewritten = buildLatest(testThread);
      expect(selectionWasReused(rewritten.profile)).toBe(false);
      const after = projectionsOf(db, thread.id);
      expect(after).toHaveLength(1);
      expect(after[0]!.events[0]).not.toBe(before!.events[0]);

      forgetTimelineProjection(db, thread.id);
      expect(projectionsOf(db, thread.id)).toEqual([]);
    });
  });

  it("drops decoded rows when the registry evicts a projection for size or count", () => {
    withTestThread((testThread) => {
      const rowChars = 1_000_000;
      const rowsPerThread = Math.ceil(
        MAX_TIMELINE_PROJECTION_DATA_BYTES / 2 / rowChars,
      );
      const big = () =>
        Array.from({ length: rowsPerThread }, (_, index) =>
          agentMessage(`big-${index}`, "x".repeat(rowChars)),
        );
      const first = addActiveThread(testThread);
      appendRows(first, [...openTurn(), ...big()]);
      buildLatest(first);
      expect(projectionsOf(testThread.db, first.thread.id)).toHaveLength(1);
      const second = addActiveThread(testThread);
      appendRows(second, [...openTurn(), ...big()]);
      buildLatest(second);
      expect(projectionsOf(testThread.db, first.thread.id)).toEqual([]);
      expect(projectionsOf(testThread.db, second.thread.id)).toHaveLength(1);
      expect(retainedDataBytes(testThread.db)).toBeLessThanOrEqual(
        MAX_TIMELINE_PROJECTION_DATA_BYTES,
      );

      for (let index = 0; index < MAX_TIMELINE_PROJECTIONS + 4; index += 1) {
        const small = addActiveThread(testThread);
        appendRows(small, openTurn());
        buildLatest(small);
      }
      expect(listTimelineProjections(testThread.db)).toHaveLength(
        MAX_TIMELINE_PROJECTIONS,
      );
      expect(projectionsOf(testThread.db, second.thread.id)).toEqual([]);
    });
  });

  it("keeps the decoded events of rows that leave the window for older pages", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      const narrow = () =>
        buildRouteTimelinePage({
          db,
          eventBudget: 4,
          includeDiagnosticOperations: false,
          page: { kind: "latest", segmentLimit: 1 },
          registry,
          thread,
          variant: "default",
        });
      appendRows(testThread, [...openTurn(), agentMessage("message-2", "a")]);
      narrow();
      const [before] = projectionsOf(db, thread.id);
      const decodedBefore = new Map(
        before!.events.map((event) => [event.meta.id, event]),
      );
      appendRows(testThread, [
        {
          data: { status: "completed" },
          turnId: "turn-1",
          type: "turn/completed",
        },
        ...userTurn(2),
        ...userTurn(3),
      ]);
      narrow();
      const [after] = projectionsOf(db, thread.id);
      expect(after!.selection.ownedSequenceStart).toBeGreaterThan(
        before!.selection.ownedSequenceStart,
      );
      const kept = new Set(after!.selection.rows.map((row) => row.id));
      const released = [...decodedBefore].filter(([id]) => !kept.has(id));
      expect(released.length).toBeGreaterThan(0);
      for (const [id, event] of released) {
        expect(after!.releasedEvents.get(id)?.event).toBe(event);
      }
      for (const id of kept) expect(after!.releasedEvents.has(id)).toBe(false);
    });
  });

  it("keeps only the hints and head-state rows the window still needs", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      const narrow = () =>
        buildRouteTimelinePage({
          db,
          eventBudget: 200,
          includeDiagnosticOperations: false,
          page: { kind: "latest", segmentLimit: 2 },
          registry,
          thread,
          variant: "default",
        });
      appendRows(testThread, openTurn());
      narrow();
      for (let index = 2; index < 12; index += 1) {
        appendRows(testThread, [
          {
            data: { status: "completed" },
            turnId: `turn-${index - 1}`,
            type: "turn/completed",
          },
          ...userTurn(index).slice(0, -1),
        ]);
        narrow();
      }
      const [projection] = projectionsOf(db, thread.id);
      expect(projection!.hints.length).toBeLessThanOrEqual(
        projection!.coverageSegmentLimit + 1,
      );
      const headStateRowIds = [...projection!.headStateEvents.keys()];
      const rowIds = new Set(
        listStoredEventRows(db, { threadId: thread.id }).map((row) => row.id),
      );
      for (const id of headStateRowIds) expect(rowIds.has(id)).toBe(true);
      expect(headStateRowIds.length).toBeLessThan(20);
    });
  });

  it("keeps no projection for a window larger than the data budget", () => {
    withTestThread((testThread) => {
      const rowChars = 1_000_000;
      const rows = Array.from(
        {
          length: Math.ceil(MAX_TIMELINE_PROJECTION_DATA_BYTES / rowChars) + 1,
        },
        (_, index) => agentMessage(`huge-${index}`, "x".repeat(rowChars)),
      );
      appendRows(testThread, [...openTurn(), ...rows]);
      buildLatest(testThread);
      expect(projectionsOf(testThread.db, testThread.thread.id)).toEqual([]);
    });
  });
});

describe("kept pageable timeline rows", () => {
  it("charges kept rows against the projection data budget", () => {
    withTestThread((testThread) => {
      const rowChars = 1_000_000;
      const rowsPerThread = Math.ceil(
        (MAX_TIMELINE_PROJECTION_DATA_BYTES * 0.3) / rowChars,
      );
      const big = () =>
        Array.from({ length: rowsPerThread }, (_, index) =>
          agentMessage(`big-${index}`, "x".repeat(rowChars)),
        );
      const first = addActiveThread(testThread);
      appendRows(first, [...openTurn(), ...big()]);
      const firstBuild = buildLatest(first);
      const [firstProjection] = projectionsOf(testThread.db, first.thread.id);
      expect(firstProjection!.derived.pageableRows.size).toBe(1);
      expect(firstProjection!.derivedBytes).toBeGreaterThan(
        rowsPerThread * rowChars,
      );

      const second = addActiveThread(testThread);
      appendRows(second, [...openTurn(), ...big()]);
      buildLatest(second);
      expect(projectionsOf(testThread.db, first.thread.id)).toEqual([]);
      expect(projectionsOf(testThread.db, second.thread.id)).toHaveLength(1);
      expect(retainedBytes(testThread.db)).toBeLessThanOrEqual(
        MAX_TIMELINE_PROJECTION_DATA_BYTES,
      );
      expect(sharedRowIds(firstBuild, buildLatest(first))).toEqual([]);
    });
  });

  it("reuses kept rows only while the projection is kept", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      appendRows(testThread, [
        ...openTurn(),
        agentMessage("message-2", "Settled"),
        messageDelta("one"),
      ]);
      const first = buildLatest(testThread);
      appendRows(testThread, [messageDelta("two")]);
      const second = buildLatest(testThread);
      expect(sharedRowIds(first, second)).not.toEqual([]);

      forgetTimelineProjection(db, thread.id);
      appendRows(testThread, [messageDelta("three")]);
      const third = buildLatest(testThread);
      expect(sharedRowIds(second, third)).toEqual([]);
    });
  });
});
