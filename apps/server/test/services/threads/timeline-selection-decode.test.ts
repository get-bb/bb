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
  byteLengthOfStoredEventRows,
  decodeTimelineSelectionRows,
  withRowMeta,
} from "../../../src/services/threads/timeline-selection-decode.js";
import {
  forgetLatestTimelineSelections,
  readDecodedLatestTimelineSelections,
  readKeptLatestTimelinePageableRows,
  TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS,
  TIMELINE_SELECTION_MEMO_MAX_ENTRIES,
} from "../../../src/services/threads/timeline-selection-memo.js";
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

function decodedOf(db: DbConnection, threadId: string) {
  return readDecodedLatestTimelineSelections(db).filter(
    (entry) => entry.threadId === threadId,
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

describe("timeline selection decode", () => {
  it("decodes only the rows appended after a decoded prefix", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      appendRows(testThread, [
        { type: "turn/started", turnId: "turn-1" },
        agentMessage("message-1", "Hello"),
      ]);
      const prefix = listStoredEventRows(db, { threadId: thread.id });
      const first = decodeTimelineSelectionRows(db, prefix, null);
      appendRows(testThread, [agentMessage("message-2", "Héllo again")]);
      const appended = listStoredEventRows(db, {
        afterSequence: prefix.at(-1)!.sequence,
        threadId: thread.id,
      });
      expect(appended).toHaveLength(1);
      const rows = [...prefix, ...appended];
      const extended = decodeTimelineSelectionRows(db, rows, first);

      expect(extended.events).toEqual(
        rows.map((row) => withRowMeta(row, parseStoredEvent(row))),
      );
      expect(extended.dataBytes).toBe(byteLengthOfStoredEventRows(rows));
      expect(extended.events[0]).toBe(first.events[0]);
      expect(extended.events[1]).toBe(first.events[1]);
      expect(first.events).toHaveLength(2);
    });
  });

  it("keeps the decoded rows on the memo entry and extends them on reuse", () => {
    withTestThread((testThread) => {
      appendRows(testThread, openTurn());
      buildLatest(testThread);
      const [first] = decodedOf(testThread.db, testThread.thread.id);
      expect(first).toBeDefined();
      appendRows(testThread, [messageDelta("one"), messageDelta("two")]);
      const warm = buildLatest(testThread);
      expect(selectionWasReused(warm.profile)).toBe(true);
      const decoded = decodedOf(testThread.db, testThread.thread.id);
      expect(decoded).toHaveLength(1);
      expect(decoded[0]!.decoded.events).toHaveLength(
        first!.decoded.events.length + 2,
      );
      expect(decoded[0]!.decoded.events[0]).toBe(first!.decoded.events[0]);
      expect(warm.profile.eventDataBytes).toBeGreaterThan(
        first!.decoded.dataBytes,
      );
    });
  });

  it("forgets decoded rows when the thread is forgotten or its history rewritten", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      appendRows(testThread, [...openTurn(), messageDelta("one")]);
      buildLatest(testThread);
      const [before] = decodedOf(db, thread.id);
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
      const after = decodedOf(db, thread.id);
      expect(after).toHaveLength(1);
      expect(after[0]!.decoded.events[0]).not.toBe(before!.decoded.events[0]);

      forgetLatestTimelineSelections(db, thread.id);
      expect(decodedOf(db, thread.id)).toEqual([]);
    });
  });

  it("drops decoded rows when the memo evicts its entry for size or count", () => {
    withTestThread((testThread) => {
      const rowChars = 1_000_000;
      const rowsPerThread = Math.ceil(
        TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS / 2 / rowChars,
      );
      const big = () =>
        Array.from({ length: rowsPerThread }, (_, index) =>
          agentMessage(`big-${index}`, "x".repeat(rowChars)),
        );
      const first = addActiveThread(testThread);
      appendRows(first, [...openTurn(), ...big()]);
      buildLatest(first);
      expect(decodedOf(testThread.db, first.thread.id)).toHaveLength(1);
      const second = addActiveThread(testThread);
      appendRows(second, [...openTurn(), ...big()]);
      buildLatest(second);
      expect(decodedOf(testThread.db, first.thread.id)).toEqual([]);
      expect(decodedOf(testThread.db, second.thread.id)).toHaveLength(1);
      const decodedChars = readDecodedLatestTimelineSelections(
        testThread.db,
      ).reduce((sum, entry) => sum + entry.dataChars, 0);
      expect(decodedChars).toBeLessThanOrEqual(
        TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS,
      );

      for (
        let index = 0;
        index < TIMELINE_SELECTION_MEMO_MAX_ENTRIES + 4;
        index += 1
      ) {
        const small = addActiveThread(testThread);
        appendRows(small, openTurn());
        buildLatest(small);
      }
      expect(readDecodedLatestTimelineSelections(testThread.db)).toHaveLength(
        TIMELINE_SELECTION_MEMO_MAX_ENTRIES,
      );
      expect(decodedOf(testThread.db, second.thread.id)).toEqual([]);
    });
  });
});

describe("kept pageable timeline rows", () => {
  it("reuses kept rows only while the memo keeps the thread's selection", () => {
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

      forgetLatestTimelineSelections(db, thread.id);
      expect(
        readKeptLatestTimelinePageableRows(db).filter(
          (kept) => kept.threadId === thread.id,
        ),
      ).toEqual([]);
      appendRows(testThread, [messageDelta("three")]);
      const third = buildLatest(testThread);
      expect(sharedRowIds(second, third)).toEqual([]);
    });
  });

  it("charges kept rows against the memo's data budget", () => {
    withTestThread((testThread) => {
      const rowChars = 1_000_000;
      const rowsPerThread = Math.ceil(
        (TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS * 0.3) / rowChars,
      );
      const big = () =>
        Array.from({ length: rowsPerThread }, (_, index) =>
          agentMessage(`big-${index}`, "x".repeat(rowChars)),
        );
      const first = addActiveThread(testThread);
      appendRows(first, [...openTurn(), ...big()]);
      const firstBuild = buildLatest(first);
      const keptOf = (threadId: string) =>
        readKeptLatestTimelinePageableRows(testThread.db).filter(
          (kept) => kept.threadId === threadId,
        );
      expect(keptOf(first.thread.id)).toHaveLength(1);
      expect(keptOf(first.thread.id)[0]!.bytes).toBeGreaterThan(
        rowsPerThread * rowChars,
      );

      const second = addActiveThread(testThread);
      appendRows(second, [...openTurn(), ...big()]);
      buildLatest(second);
      expect(keptOf(first.thread.id)).toEqual([]);
      expect(keptOf(second.thread.id)).toHaveLength(1);
      const retained =
        readKeptLatestTimelinePageableRows(testThread.db).reduce(
          (sum, kept) => sum + kept.bytes,
          0,
        ) +
        readDecodedLatestTimelineSelections(testThread.db).reduce(
          (sum, entry) => sum + entry.dataChars,
          0,
        );
      expect(retained).toBeLessThanOrEqual(
        TIMELINE_SELECTION_MEMO_MAX_DATA_CHARS,
      );
      expect(sharedRowIds(firstBuild, buildLatest(first))).toEqual([]);
    });
  });
});
