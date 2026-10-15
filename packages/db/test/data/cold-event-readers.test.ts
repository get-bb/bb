import { runStoredPayloadCompressionMaintenance } from "../../src/data/stored-payload-compression.js";
import { getAppSettings, setAppSettings } from "../../src/data/app-settings.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import * as readers from "../../src/data/events.js";
import { compressColdThreadEvents } from "../../src/data/cold-event-chunks.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../../src/testing.js";
import type { DbConnection } from "../../src/connection.js";

const connections: DbConnection[] = [];
const requestIds = Array.from({ length: 11 }, (_, value) =>
  encodeClientTurnRequestIdNumber({ value }),
);

function setup() {
  const db = createMigratedConnection();
  connections.push(db);
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "cold-readers",
    source: { type: "local_path", hostId: host.id, path: "/tmp/cold-readers" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  const rows: readers.InsertEventInput[] = [];
  const add = (
    type: readers.InsertEventInput["type"],
    fields: Partial<readers.InsertEventInput> = {},
    data: object = {},
  ) => {
    rows.push({
      threadId: thread.id,
      sequence: rows.length + 1,
      scope: threadScope(),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      type,
      data: JSON.stringify(data),
      ...fields,
    });
  };
  for (let index = 0; index < 10; index += 1) {
    const turn = { scope: turnScope(`turn-${index}`) };
    const tool = { ...turn, itemId: "call", itemKind: "toolCall" as const };
    const child = {
      scope: turnScope(`nested-${index}`),
      itemId: "child",
      itemKind: "agentMessage" as const,
      parentToolCallId: "call",
    };
    add("turn/started", turn);
    add("item/started", tool, { item: { type: "toolCall", toolName: "test" } });
    add(
      "client/turn/requested",
      {},
      {
        requestId: requestIds[index],
        initiator: "user",
        input: [{ type: "text", text: "message".repeat(500), mentions: [] }],
        target: { kind: "new-turn" },
      },
    );
    add("turn/input/accepted", turn, { clientRequestId: requestIds[index] });
    add("item/started", child, { item: { type: "agentMessage", text: "" } });
    add(
      "item/agentMessage/delta",
      { ...child, itemId: `buffered-${index}` },
      { delta: "partial" },
    );
    add("item/completed", child, {
      item: { type: "agentMessage", text: "answer".repeat(5000) },
    });
    add("item/completed", tool, {
      item: { type: "toolCall", result: "output🙂".repeat(3500) },
    });
    add("system/thread/interrupted", {}, { reason: "user" });
    add("turn/completed", turn);
    add(
      "client/turn/rejected",
      {},
      { requestId: requestIds[index], reason: "test" },
    );
  }
  add("item/started", { itemId: "call", itemKind: "toolCall" });
  add("item/completed", { itemId: "call", itemKind: "toolCall" });
  readers.insertEvents(db, noopNotifier, rows);
  const now = Date.now();
  db.$client
    .prepare("UPDATE threads SET status = 'idle', updated_at = ? WHERE id = ?")
    .run(now - 8 * 24 * 60 * 60 * 1000, thread.id);
  return { db, threadId: thread.id, now };
}

afterEach(() => {
  while (connections.length > 0) connections.pop()?.$client.close();
});

const scopedItems: readers.ScopedItemRef[] = [
  { itemId: "call", scopeKind: "turn", turnId: "turn-0" },
  { itemId: "call", scopeKind: "turn", turnId: "turn-1" },
  { itemId: "call", scopeKind: "thread", turnId: null },
  { itemId: "child", scopeKind: "turn", turnId: "nested-0" },
];

const cases: Array<{
  name: string;
  read: (db: DbConnection, threadId: string) => unknown;
}> = [
  {
    name: "event pagination",
    read: (db, threadId) =>
      readers.listEvents(db, { threadId, afterSequence: 2, limit: 4 }),
  },
  {
    name: "descending typed pagination",
    read: (db, threadId) =>
      readers.listStoredEventRows(db, {
        threadId,
        types: ["item/started", "item/completed"],
        afterSequence: 2,
        beforeSequence: 32,
        order: "desc",
        limit: 4,
      }),
  },
  {
    name: "an inline-only page in a compressed thread",
    read: (db, threadId) =>
      readers.listStoredEventRows(db, {
        threadId,
        types: ["item/started", "item/completed"],
        afterSequence: 110,
        limit: 1,
      }),
  },
  {
    name: "ordering context",
    read: (db, threadId) =>
      readers.listTimelineOrderingContext(db, {
        threadId,
        sequenceStart: 2,
        maxSeq: 23,
      }),
  },
  {
    name: "grouping context changes",
    read: (db, threadId) =>
      readers.getTimelineGroupingContextChangesInRange(db, {
        threadId,
        afterSequence: 2,
        throughSequence: 8,
      }),
  },
  {
    name: "request hints",
    read: (db, threadId) =>
      readers.listTimelineWindowHintsDescending(db, {
        threadId,
        sequenceStart: 2,
        beforeSequence: 25,
        limit: 2,
      }),
  },
  {
    name: "event budget",
    read: (db, threadId) =>
      readers.findTimelineWindowBudgetFloorSequence(db, {
        threadId,
        sequenceStart: 2,
        beforeSequence: 24,
        excludedTypes: ["item/agentMessage/delta"],
        eventBudget: 5,
      }),
  },
  {
    name: "sequence page",
    read: (db, threadId) =>
      readers.listStoredEventRowsInSequenceRange(db, {
        threadId,
        afterSequence: 1,
        throughSequence: 24,
        limit: 9,
        maxInlineOutputChars: 20,
      }),
  },
  {
    name: "turn windows",
    read: (db, threadId) =>
      readers.listStoredTimelineTurnEventRows(db, {
        threadId,
        sequenceStart: 2,
        beforeSequence: 25,
        excludedTypes: ["item/agentMessage/delta"],
        turnIds: ["turn-0", "nested-1"],
        maxInlineOutputChars: 20,
      }),
  },
  {
    name: "thread window",
    read: (db, threadId) =>
      readers.listStoredTimelineThreadWindowEventRows(db, {
        threadId,
        sequenceStart: 2,
        beforeSequence: 25,
        maxInlineOutputChars: null,
      }),
  },
  {
    name: "complete window",
    read: (db, threadId) =>
      readers.listStoredTimelineWindowEventRows(db, {
        threadId,
        sequenceStart: 2,
        beforeSequence: 25,
        maxInlineOutputChars: 20,
      }),
  },
  {
    name: "root turns",
    read: (db, threadId) =>
      readers
        .listTimelineRootWindowTurnIds(db, {
          threadId,
          sequenceStart: 2,
          beforeSequence: 25,
          maxInlineOutputChars: null,
        })
        .sort(),
  },
  {
    name: "interruptions",
    read: (db, threadId) =>
      readers.listTimelineInterruptionRows(db, {
        threadId,
        sequenceStart: 1,
        maxSeq: 24,
      }),
  },
  {
    name: "parent tool calls",
    read: (db, threadId) =>
      readers.listStoredEventRowsByParentToolCallIds(db, {
        threadId,
        parentToolCallIds: ["call"],
        sequenceStart: 2,
        beforeSequence: 20,
        excludedTypes: ["item/agentMessage/delta"],
        maxInlineOutputChars: 20,
      }),
  },
  {
    name: "delegating items",
    read: (db, threadId) =>
      readers.listStoredDelegatingItemRowsByItemIds(db, {
        threadId,
        itemIds: ["call"],
        maxInlineOutputChars: 20,
      }),
  },
  {
    name: "turn starts",
    read: (db, threadId) =>
      readers.listStoredTurnStartedRowsByTurnIdsUpToSequence(db, {
        threadId,
        turnIds: ["turn-0", "turn-1"],
        sequenceCutoff: 23,
      }),
  },
  {
    name: "turn completions",
    read: (db, threadId) =>
      readers.listStoredTurnCompletedRowsByTurnIds(db, {
        threadId,
        turnIds: ["turn-0", "turn-1"],
      }),
  },
  {
    name: "accepted input",
    read: (db, threadId) =>
      readers.listStoredTurnInputAcceptedRowsByClientRequestIds(db, {
        threadId,
        clientRequestIds: requestIds,
        afterSequence: 2,
      }),
  },
  {
    name: "rejected input",
    read: (db, threadId) =>
      readers.listStoredTurnRejectedRowsByClientRequestIds(db, {
        threadId,
        clientRequestIds: requestIds,
        afterSequence: 2,
      }),
  },
  {
    name: "turn request",
    read: (db, threadId) =>
      readers.getStoredTurnRequestEventForTurn(db, {
        threadId,
        turnId: "turn-0",
      }),
  },
  {
    name: "first matching event",
    read: (db, threadId) =>
      readers.findStoredEventRow(db, {
        threadId,
        afterSequence: 2,
        type: "item/completed",
      }),
  },
  {
    name: "cursor presence",
    read: (db, threadId) =>
      [7, 999].map((sequence) =>
        readers.isTimelineCursorSequencePresent(db, { threadId, sequence }),
      ),
  },
  {
    name: "request identifiers",
    read: (db, threadId) =>
      readers.listStoredClientTurnRequestIdsInRange(db, {
        threadId,
        seqStart: 1,
        seqEnd: 23,
      }),
  },
  {
    name: "request keys",
    read: (db, threadId) =>
      readers.listStoredClientTurnRequestRowsByKeys(db, {
        keys: requestIds.map((requestId) => ({ threadId, requestId })),
      }),
  },
  {
    name: "item spans with reused identifiers",
    read: (db, threadId) =>
      readers
        .listItemEventSpansByItems(db, { threadId, items: scopedItems })
        .sort((a, b) =>
          readers
            .scopedItemRefKey(a)
            .localeCompare(readers.scopedItemRefKey(b)),
        ),
  },
  {
    name: "item lifecycle range",
    read: (db, threadId) =>
      readers.getStoredItemLifecycleSequenceRange(db, {
        threadId,
        turnId: "turn-0",
        itemId: "call",
      }),
  },
  {
    name: "item lifecycles",
    read: (db, threadId) =>
      readers.listStoredItemLifecycleRowsByItems(db, {
        threadId,
        items: scopedItems,
        maxInlineOutputChars: 20,
      }),
  },
  {
    name: "conversation outline",
    read: (db, threadId) =>
      readers.listStoredConversationOutlineEventRows(db, {
        threadId,
        sequenceStart: 1,
      }),
  },
  {
    name: "root conversation outline",
    read: (db, threadId) =>
      readers.listStoredRootConversationOutlineEventRows(db, {
        threadId,
        sequenceStart: 1,
      }),
  },
  {
    name: "latest outline sequence",
    read: (db, threadId) =>
      readers.getLatestStoredConversationOutlineSequence(db, { threadId }),
  },
  {
    name: "outline projection classification",
    read: (db, threadId) =>
      readers.getStoredConversationOutlineProjectionState(db, {
        threadId,
        sequenceStart: 1,
        classificationSequenceStart: 1,
        summaryCompactionDeltaThreshold: 2,
      }),
  },
  {
    name: "turn existence and keys",
    read: (db, threadId) => ({
      exists: readers.hasStoredTurnStarted(db, { threadId, turnId: "turn-0" }),
      roots: readers.hasRootStoredTurnStarted(db, {
        threadId,
        turnId: "turn-0",
      }),
      started: readers.listStoredTurnStartedKeys(db, {
        keys: [{ threadId, turnId: "turn-0" }],
      }),
      completed: readers.listStoredTurnCompletedKeys(db, {
        keys: [{ threadId, turnId: "turn-0" }],
      }),
    }),
  },
  {
    name: "latest typed completion",
    read: (db, threadId) =>
      readers.getLatestStoredThreadEventOfTypes(db, {
        threadId,
        types: ["item/completed"],
        afterSequence: 0,
      }),
  },
  ...[1, 100_000, 10_000_000].map((maxDataBytes) => ({
    name: `byte budget ${maxDataBytes}`,
    read: (db: DbConnection, threadId: string) =>
      readers.findStoredTimelineWindowByteBudgetFloor(db, {
        threadId,
        sequenceStart: 1,
        beforeSequence: 24,
        maxInlineOutputChars: 20,
        maxDataBytes,
      }),
  })),
];

describe("compressed event reader contracts", () => {
  it.each(
    cases.flatMap((entry) => [
      { ...entry, storage: "chunks" },
      { ...entry, storage: "payloads" },
    ]),
  )("preserves $name with $storage", ({ read, storage }) => {
    const { db, threadId, now } = setup();
    const before = read(db, threadId);
    expect(before).not.toBeNull();
    expect(before).not.toEqual([]);
    if (storage === "chunks") {
      const result = compressColdThreadEvents(db, { threadId, now });
      expect(result.eventsCompressed).toBeGreaterThan(5);
      expect(result.chunksWritten).toBeGreaterThan(1);
    } else {
      setAppSettings(db, { ...getAppSettings(db), coldEventCompression: true });
      let compressed = 0;
      for (let pass = 0; pass < 8; pass++)
        compressed += runStoredPayloadCompressionMaintenance(db).rowsCompressed;
      expect(compressed).toBeGreaterThan(5);
    }
    expect(read(db, threadId)).toEqual(before);
  });

  it("keeps control records inline while compressing completed text and tools", () => {
    const { db, threadId, now } = setup();
    const before = readers.listEvents(db, { threadId });
    compressColdThreadEvents(db, { now, threadId });
    const ids = new Set(
      db.$client
        .prepare<[string], { id: string }>(
          "SELECT id FROM events WHERE thread_id = ?",
        )
        .all(threadId)
        .map((row) => row.id),
    );
    const compressed = before.filter((row) => !ids.has(row.id));
    expect(compressed.length).toBeGreaterThan(5);
    expect(compressed.every((row) => row.type === "item/completed")).toBe(true);
    expect(compressed.some((row) => row.itemKind === "toolCall")).toBe(true);
    expect(
      before
        .filter((row) => row.type !== "item/completed")
        .every((row) => ids.has(row.id)),
    ).toBe(true);
  });

  it("suppresses completed-item replays and accepts a restarted item in a new turn", () => {
    const { db, threadId, now } = setup();
    compressColdThreadEvents(db, { now, threadId });
    const fields = {
      threadId,
      environmentId: null,
      providerThreadId: null,
      parentToolCallId: null,
    };
    const item = {
      itemId: "child",
      itemKind: "agentMessage" as const,
      data: JSON.stringify({
        item: { id: "child", type: "agentMessage", text: "new answer" },
      }),
    };
    const result = db.transaction((tx) =>
      readers.appendDaemonEventsInTransaction(tx, [
        { ...fields, ...item, scope: threadScope(), type: "item/completed" },
        {
          ...fields,
          itemId: null,
          itemKind: null,
          scope: turnScope("turn-0"),
          type: "turn/started",
          data: "{}",
        },
        {
          ...fields,
          itemId: null,
          itemKind: null,
          scope: turnScope("resumed"),
          type: "turn/started",
          data: "{}",
        },
        {
          ...fields,
          ...item,
          scope: turnScope("resumed"),
          type: "item/started",
        },
        {
          ...fields,
          ...item,
          scope: turnScope("resumed"),
          type: "item/completed",
        },
      ]),
    );
    expect(result.insertedInputIndexes).toEqual([2, 3, 4]);
    expect(result.acceptedEvents.map((row) => row.sequence)).toEqual([
      113, 114, 115,
    ]);
  });

  it.each([
    { sequenceStart: 0, maxSeq: 20, expected: 3 },
    { sequenceStart: 3, maxSeq: 11, expected: null },
    { sequenceStart: 0, maxSeq: 4, expected: null },
  ])(
    "preserves nested boundaries in $sequenceStart through $maxSeq",
    ({ expected, ...range }) => {
      const { db, threadId, now } = setup();
      expect(
        readers.getFirstParentedTimelineBoundarySequence(db, {
          threadId,
          ...range,
        }),
      ).toBe(expected);
      compressColdThreadEvents(db, { threadId, now });
      expect(
        readers.getFirstParentedTimelineBoundarySequence(db, {
          threadId,
          ...range,
        }),
      ).toBe(expected);
    },
  );
});
