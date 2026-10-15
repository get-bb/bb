import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { threadScope, turnScope } from "@bb/domain";
import { createMigratedConnection } from "../../src/testing.js";
import type { DbConnection } from "../../src/connection.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";
import { noopNotifier } from "../../src/notifier.js";
import { eventColdChunks, events, threads } from "../../src/schema.js";
import {
  ColdEventChunkVerifyError,
  compressColdThreadEvents,
  threadHasColdChunks,
} from "../../src/data/cold-event-chunks.js";
import {
  appendDaemonEventsInTransaction,
  deleteThreadEventSuffixInTransaction,
  findStoredTimelineWindowByteBudgetFloor,
  findStoredEventRow,
  getHighWaterMarks,
  getLatestThreadOutputEventRow,
  listEvents,
  listStoredConversationOutlineEventRows,
  listStoredEventRows,
  listStoredTimelineWindowEventRows,
} from "../../src/data/events.js";
import { selectColdEventRecords } from "../../src/data/cold-event-chunks.js";
import { advanceLiveEventPruning } from "../../src/data/resolved-item-pruning.js";
import { migrateNextCompletedEventItemOutput } from "../../src/data/sweeps.js";
import { getAppSettings, setAppSettings } from "../../src/data/app-settings.js";
import { runStoredPayloadCompressionMaintenance } from "../../src/data/stored-payload-compression.js";
import { RETAINED_EVENT_OUTPUT_TARGETS } from "../../src/retained-event-output.js";

vi.mock("node:zlib", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:zlib")>();
  return {
    ...original,
    zstdDecompressSync: vi.fn(original.zstdDecompressSync),
  };
});

const connections: DbConnection[] = [];
const now = Date.now();
const coldAt = now - 8 * 24 * 60 * 60 * 1000;

function setup() {
  const db = createMigratedConnection();
  connections.push(db);
  const host = upsertHost(db, noopNotifier, { name: "cold-storage" });
  const { project } = createProject(db, noopNotifier, {
    name: "cold-storage",
    source: { type: "local_path", hostId: host.id, path: "/tmp/cold-storage" },
  });
  const makeThread = (count: number, text = "text".repeat(4096)) => {
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    for (let sequence = 1; sequence <= count; sequence += 1)
      db.insert(events)
        .values({
          id: `${thread.id}-${sequence}`,
          threadId: thread.id,
          scopeKind: "thread",
          sequence,
          type: "item/completed",
          itemKind: "agentMessage",
          itemId: `message-${sequence}`,
          data: JSON.stringify({
            item: { id: `message-${sequence}`, type: "agentMessage", text },
          }),
          createdAt: coldAt,
        })
        .run();
    db.update(threads)
      .set({ status: "idle", updatedAt: coldAt })
      .where(eq(threads.id, thread.id))
      .run();
    return thread;
  };
  return { db, makeThread };
}

afterEach(() => {
  while (connections.length) connections.pop()?.$client.close();
  vi.clearAllMocks();
});

describe("cold event storage safety", () => {
  it.each(
    RETAINED_EVENT_OUTPUT_TARGETS.flatMap((target) => [
      { ...target, storage: "plaintext" },
      { ...target, storage: "compressed" },
    ]),
  )(
    "keeps $storage legacy $itemKind output visible until its retention migration runs",
    ({ storage, ...target }) => {
      const { db, makeThread } = setup();
      const thread = makeThread(3);
      db.update(events)
        .set({
          itemKind: target.itemKind,
          data: JSON.stringify({
            item: {
              type: target.itemKind,
              [target.outputPath]: "legacy".repeat(8192),
            },
          }),
        })
        .where(eq(events.id, `${thread.id}-1`))
        .run();
      compressColdThreadEvents(db, { now, threadId: thread.id });
      if (storage === "compressed") {
        setAppSettings(db, {
          ...getAppSettings(db),
          coldEventCompression: true,
        });
        for (let pass = 0; pass < 8; pass++)
          runStoredPayloadCompressionMaintenance(db);
        expect(
          db.$client
            .prepare("SELECT typeof(data) AS kind FROM events WHERE id=?")
            .get(`${thread.id}-1`),
        ).toEqual({ kind: "blob" });
      }
      expect(
        db
          .select()
          .from(events)
          .where(eq(events.id, `${thread.id}-1`))
          .get(),
      ).toBeDefined();
      const migration = migrateNextCompletedEventItemOutput(db, {
        ...target,
        migratedAt: now,
        limit: 100,
      });
      expect(migration.action).toBe("migrated");
      expect(migration.eventId).toBe(`${thread.id}-1`);
      const migrated = listEvents(db, { threadId: thread.id });
      expect(
        compressColdThreadEvents(db, { now, threadId: thread.id })
          .eventsCompressed,
      ).toBe(1);
      expect(listEvents(db, { threadId: thread.id })).toEqual(migrated);
    },
  );

  it("leaves tiny payloads inline when compressed metadata would cost more", () => {
    const { db, makeThread } = setup();
    const thread = makeThread(2, "tiny");
    const history = listEvents(db, { threadId: thread.id });
    const result = compressColdThreadEvents(db, { now, threadId: thread.id });
    expect(result.eventsCompressed).toBe(0);
    expect(result.delta.storedBytes).toBe(0);
    expect(listEvents(db, { threadId: thread.id })).toEqual(history);
  });

  it("compresses completed tool payloads and text with retained deltas losslessly", () => {
    const { db, makeThread } = setup();
    const thread = makeThread(8);
    const kinds = [
      "commandExecution",
      "fileChange",
      "toolCall",
      "webFetch",
      "webSearch",
      "imageGeneration",
      "reasoning",
    ] as const;
    for (const [index, kind] of kinds.entries())
      db.update(events)
        .set({
          itemKind: kind,
          scopeKind: "turn",
          turnId: "old",
          data: JSON.stringify({
            item: {
              type: kind,
              status: "completed",
              text: "text".repeat(4096),
              result: "output".repeat(4096),
              aggregatedOutput: "command".repeat(4096),
            },
          }),
        })
        .where(eq(events.id, `${thread.id}-${index + 1}`))
        .run();
    db.insert(events)
      .values({
        id: `${thread.id}-delta`,
        threadId: thread.id,
        scopeKind: "turn",
        turnId: "old",
        sequence: 9,
        type: "item/reasoning/textDelta",
        itemId: "message-7",
        data: '{"delta":"still retained"}',
        createdAt: coldAt,
      })
      .run();
    const before = listEvents(db, { threadId: thread.id });
    const limits = [0, 20, 4000, 10];
    const readLimits = () =>
      limits.map((maxInlineOutputChars) =>
        listStoredTimelineWindowEventRows(db, {
          threadId: thread.id,
          sequenceStart: 1,
          beforeSequence: 10,
          maxInlineOutputChars,
        }),
      );
    const boundedBefore = readLimits();
    const outline = listStoredConversationOutlineEventRows(db, {
      threadId: thread.id,
      sequenceStart: 1,
    });
    const result = compressColdThreadEvents(db, { now, threadId: thread.id });
    expect(result.eventsCompressed).toBe(7);
    expect(readLimits()).toEqual(boundedBefore);
    expect(result.after.storedBytes).toBeLessThan(
      result.before.storedBytes / 4,
    );
    expect(listEvents(db, { threadId: thread.id })).toEqual(before);
    expect(
      listStoredConversationOutlineEventRows(db, {
        threadId: thread.id,
        sequenceStart: 1,
      }),
    ).toEqual(outline);
    expect(db.select({ sequence: events.sequence }).from(events).all()).toEqual(
      [{ sequence: 8 }, { sequence: 9 }],
    );
  });

  it("deletes a compressed suffix and appends at the surviving high-water mark", () => {
    const { db, makeThread } = setup();
    const thread = makeThread(90);
    const before = listEvents(db, { threadId: thread.id });
    compressColdThreadEvents(db, { now, threadId: thread.id });
    expect(listEvents(db, { threadId: thread.id })).toEqual(before);
    const removed = db.transaction((tx) =>
      deleteThreadEventSuffixInTransaction(tx, {
        threadId: thread.id,
        cutoffSequence: 28,
        oldMaxSequence: 90,
      }),
    );
    expect(removed.deletedEventCount).toBe(63);
    expect(listEvents(db, { threadId: thread.id })).toEqual(
      before.slice(0, 27),
    );
    expect(getHighWaterMarks(db, [thread.id])[thread.id]).toBe(27);
    const appended = db.transaction((tx) =>
      appendDaemonEventsInTransaction(tx, [
        {
          threadId: thread.id,
          scope: threadScope(),
          environmentId: null,
          providerThreadId: null,
          itemId: "replacement",
          itemKind: "agentMessage",
          parentToolCallId: null,
          type: "item/completed",
          data: JSON.stringify({
            item: {
              id: "replacement",
              type: "agentMessage",
              text: "replacement",
            },
          }),
        },
      ]),
    );
    expect(appended.acceptedEvents).toEqual([
      { threadId: thread.id, sequence: 28 },
    ]);
    expect(
      listEvents(db, { threadId: thread.id }).map((row) => row.sequence),
    ).toEqual(Array.from({ length: 28 }, (_, index) => index + 1));
  });

  it("rolls compressed deletion back without invalidating readable history", () => {
    const { db, makeThread } = setup();
    const thread = makeThread(40);
    const before = listEvents(db, { threadId: thread.id });
    compressColdThreadEvents(db, { now, threadId: thread.id });
    const chunks = db.select().from(eventColdChunks).all();
    listEvents(db, { threadId: thread.id });
    expect(() =>
      db.transaction((tx) => {
        deleteThreadEventSuffixInTransaction(tx, {
          threadId: thread.id,
          cutoffSequence: 5,
          oldMaxSequence: 40,
        });
        throw new Error("cancel edit");
      }),
    ).toThrow("cancel edit");
    expect(db.select().from(eventColdChunks).all()).toEqual(chunks);
    expect(listEvents(db, { threadId: thread.id })).toEqual(before);
  });

  it("advances past a full scan window of exhausted threads", () => {
    const { db, makeThread } = setup();
    const candidates = Array.from({ length: 33 }, () => makeThread(1)).sort(
      (a, b) => a.id.localeCompare(b.id),
    );
    candidates.forEach((thread, index) =>
      db
        .update(threads)
        .set({ updatedAt: coldAt + index })
        .where(eq(threads.id, thread.id))
        .run(),
    );
    const last = candidates.at(-1);
    if (!last) throw new Error("Missing candidate");
    db.insert(events)
      .values({
        id: `${last.id}-2`,
        threadId: last.id,
        scopeKind: "thread",
        sequence: 2,
        type: "item/completed",
        itemKind: "agentMessage",
        data: JSON.stringify({ item: { type: "agentMessage", text: "later" } }),
        createdAt: coldAt,
      })
      .run();
    expect(compressColdThreadEvents(db, { now }).eventsCompressed).toBe(0);
    expect(compressColdThreadEvents(db, { now }).threadIds).toEqual([last.id]);
  });

  it("does not expand existing history to benchmark a maintenance pass", () => {
    const { db, makeThread } = setup();
    const thread = makeThread(90);
    compressColdThreadEvents(db, { now, threadId: thread.id });
    db.update(eventColdChunks)
      .set({ payload: Buffer.from("corrupt") })
      .run();
    for (const sequence of [91, 92])
      db.insert(events)
        .values({
          id: `${thread.id}-${sequence}`,
          threadId: thread.id,
          scopeKind: "thread",
          sequence,
          type: "item/completed",
          itemKind: "agentMessage",
          itemId: `message-${sequence}`,
          data: JSON.stringify({
            item: { type: "agentMessage", text: "new text".repeat(1000) },
          }),
          createdAt: coldAt,
        })
        .run();
    const result = compressColdThreadEvents(db, { now, threadId: thread.id });
    expect(result.eventsCompressed).toBe(2);
    expect(result.before.firstOpenMs).toBeNull();
    expect(result.after.firstOpenMs).toBeNull();
    expect(result.summary).toContain(
      "| First open (ms) | not measured | not measured | not measured |",
    );
  });

  it("bounds cold reads and existence checks without decoding unrelated chunks", () => {
    const { db, makeThread } = setup();
    const thread = makeThread(90);
    const before = listEvents(db, { threadId: thread.id });
    compressColdThreadEvents(db, { now, threadId: thread.id });
    const first = db
      .select()
      .from(eventColdChunks)
      .orderBy(eventColdChunks.seqStart)
      .get();
    if (!first) throw new Error("Missing chunk");
    db.update(eventColdChunks)
      .set({ payload: Buffer.from("corrupt") })
      .where(eq(eventColdChunks.id, first.id))
      .run();
    vi.mocked(zstdDecompressSync).mockClear();
    expect(threadHasColdChunks(db, thread.id)).toBe(true);
    expect(zstdDecompressSync).not.toHaveBeenCalled();
    expect(
      listStoredEventRows(db, {
        threadId: thread.id,
        afterSequence: first.seqEnd,
        limit: 1,
      })[0]?.sequence,
    ).toBe(first.seqEnd + 1);
    expect(zstdDecompressSync).toHaveBeenCalledTimes(1);
    vi.mocked(zstdDecompressSync).mockClear();
    const latest = listStoredEventRows(db, {
      threadId: thread.id,
      order: "desc",
      limit: 1,
    });
    expect(latest[0]?.id).toBe(before.at(-1)?.id);
    expect(zstdDecompressSync).not.toHaveBeenCalled();
    expect(
      findStoredTimelineWindowByteBudgetFloor(db, {
        threadId: thread.id,
        sequenceStart: 1,
        maxDataBytes: 100,
        maxInlineOutputChars: null,
      }),
    ).toMatchObject({
      kind: "single-event-too-large",
      sequenceStart: 90,
      hasOlderRows: true,
    });
    expect(
      getLatestThreadOutputEventRow(db, { threadId: thread.id })?.sequence,
    ).toBe(90);
    expect(() => listEvents(db, { threadId: thread.id })).toThrow(
      ColdEventChunkVerifyError,
    );
    db.update(eventColdChunks)
      .set({ payload: first.payload })
      .where(eq(eventColdChunks.id, first.id))
      .run();
    const last = db
      .select()
      .from(eventColdChunks)
      .orderBy(desc(eventColdChunks.seqStart))
      .get();
    if (!last) throw new Error("Missing latest chunk");
    db.update(eventColdChunks)
      .set({ payload: Buffer.from("corrupt") })
      .where(eq(eventColdChunks.id, last.id))
      .run();
    expect(
      findStoredEventRow(db, {
        threadId: thread.id,
        type: "item/completed",
      })?.sequence,
    ).toBe(1);
  });

  it("looks up large item sets without exceeding SQLite's parameter limit", () => {
    const { db, makeThread } = setup();
    const thread = makeThread(3);
    compressColdThreadEvents(db, { now, threadId: thread.id });
    const itemIds = [
      ...Array.from({ length: 40_000 }, (_, index) => `absent-${index}`),
      "message-1",
    ];
    expect(
      selectColdEventRecords(db, { threadId: thread.id, itemIds }).map(
        (row) => row.sequence,
      ),
    ).toEqual([1]);
  });

  it("normalizes malformed item-index JSON during targeted reads", () => {
    const { db, makeThread } = setup();
    const thread = makeThread(3);
    compressColdThreadEvents(db, { now, threadId: thread.id });
    db.$client
      .prepare("UPDATE event_cold_chunks SET item_ids = ? WHERE thread_id = ?")
      .run("invalid-json", thread.id);
    expect(() =>
      selectColdEventRecords(db, {
        threadId: thread.id,
        itemIds: ["message-1"],
      }),
    ).toThrow(ColdEventChunkVerifyError);
  });

  it("releases byte-budget iterators when a selected chunk is corrupt", () => {
    const { db, makeThread } = setup();
    const thread = makeThread(3);
    compressColdThreadEvents(db, { now, threadId: thread.id });
    db.update(eventColdChunks)
      .set({ payload: Buffer.from("corrupt") })
      .run();
    expect(() =>
      findStoredTimelineWindowByteBudgetFloor(db, {
        threadId: thread.id,
        sequenceStart: 1,
        maxDataBytes: 100,
        maxInlineOutputChars: null,
      }),
    ).toThrow(ColdEventChunkVerifyError);
    connections.splice(connections.indexOf(db), 1);
    expect(() => db.$client.close()).not.toThrow();
  });

  it.each([
    { kind: "agentMessage", output: {}, hasOutput: true },
    { kind: "commandExecution", output: {}, hasOutput: false },
    {
      kind: "commandExecution",
      output: { aggregatedOutput: null },
      hasOutput: true,
    },
    {
      kind: "commandExecution",
      output: { aggregatedOutput: "" },
      hasOutput: true,
    },
    {
      kind: "commandExecution",
      output: { aggregatedOutput: "complete" },
      hasOutput: true,
    },
  ] as const)(
    "prunes replayed deltas using $kind completion with $output",
    ({ kind, output, hasOutput }) => {
      const scenario = (compress: boolean) => {
        const { db, makeThread } = setup();
        const thread = makeThread(4);
        db.update(events)
          .set({
            type: "turn/started",
            itemId: null,
            itemKind: null,
            scopeKind: "turn",
            turnId: "old",
            data: "{}",
          })
          .where(eq(events.id, `${thread.id}-1`))
          .run();
        db.update(events)
          .set({
            itemId: "old-item",
            itemKind: kind,
            scopeKind: "turn",
            turnId: "old",
            data: JSON.stringify({
              item: { type: kind, text: "history".repeat(4096), ...output },
            }),
          })
          .where(eq(events.id, `${thread.id}-2`))
          .run();
        if (compress) {
          expect(
            compressColdThreadEvents(db, { now, threadId: thread.id })
              .eventsCompressed,
          ).toBeGreaterThan(0);
          expect(
            selectColdEventRecords(db, {
              threadId: thread.id,
              itemIds: ["old-item"],
            }),
          ).toHaveLength(1);
        }
        const deltaType =
          kind === "commandExecution"
            ? "item/commandExecution/outputDelta"
            : "item/agentMessage/delta";
        db.transaction((tx) =>
          appendDaemonEventsInTransaction(
            tx,
            ["a", "b", "c"].map((delta) => ({
              threadId: thread.id,
              environmentId: null,
              providerThreadId: null,
              scope: turnScope("old"),
              itemId: "old-item",
              itemKind: kind,
              parentToolCallId: null,
              type: deltaType,
              data: JSON.stringify({ delta }),
            })),
          ),
        );
        let complete = false;
        for (let pass = 0; pass < 20 && !complete; pass += 1)
          complete = advanceLiveEventPruning(db, {
            threadId: thread.id,
            kind: "deltas",
            limit: 4,
          }).complete;
        expect(complete).toBe(true);
        return listEvents(db, { threadId: thread.id })
          .filter((row) => row.type === deltaType)
          .map((row) => row.sequence);
      };
      const expected = hasOutput ? [5, 7] : [5, 6, 7];
      expect(scenario(false)).toEqual(expected);
      expect(scenario(true)).toEqual(expected);
    },
  );

  it("evicts old expanded chunks when its memory budget is reached", () => {
    const { db, makeThread } = setup();
    const candidates = Array.from({ length: 3 }, () =>
      makeThread(2, "x".repeat(1024 * 1024)),
    );
    for (const thread of candidates)
      compressColdThreadEvents(db, { now, threadId: thread.id });
    vi.mocked(zstdDecompressSync).mockClear();
    const read = (index: number) => {
      const thread = candidates[index];
      if (!thread) throw new Error("Missing thread");
      return listEvents(db, { threadId: thread.id });
    };
    read(0);
    read(0);
    expect(zstdDecompressSync).toHaveBeenCalledTimes(1);
    read(1);
    read(2);
    expect(zstdDecompressSync).toHaveBeenCalledTimes(3);
    read(0);
    expect(zstdDecompressSync).toHaveBeenCalledTimes(4);
  });

  it.each([
    { name: "event count", metadata: { eventCount: 999 } },
    { name: "codec", metadata: { codec: "unsupported" } },
    { name: "sequence range", metadata: { seqStart: 0 } },
    { name: "item index", metadata: { itemIds: ["absent"] } },
    {
      name: "record ownership",
      mutate: (record: Record<string, unknown>) => {
        record.threadId = "another-thread";
      },
    },
    {
      name: "record type",
      mutate: (record: Record<string, unknown>) => {
        record.type = "invalid-event";
      },
    },
    {
      name: "record scope",
      mutate: (record: Record<string, unknown>) => {
        record.scopeKind = "turn";
      },
    },
    {
      name: "record item kind",
      mutate: (record: Record<string, unknown>) => {
        record.itemKind = "invalid-item";
      },
    },
    {
      name: "record data",
      mutate: (record: Record<string, unknown>) => {
        record.data = "invalid-json";
      },
    },
  ])("rejects invalid $name at the chunk boundary", ({ metadata, mutate }) => {
    const { db, makeThread } = setup();
    const thread = makeThread(3);
    const before = listEvents(db, { threadId: thread.id });
    compressColdThreadEvents(db, { now, threadId: thread.id });
    const chunk = db.select().from(eventColdChunks).get();
    if (!chunk) throw new Error("Missing chunk");
    if (metadata)
      db.update(eventColdChunks)
        .set(metadata)
        .where(eq(eventColdChunks.id, chunk.id))
        .run();
    if (mutate) {
      const records: Record<string, unknown>[] = before
        .filter((row) => row.sequence <= chunk.seqEnd)
        .map((row) => ({ ...row }));
      const record = records[0];
      if (!record) throw new Error("Missing record");
      mutate(record);
      const json = Buffer.from(JSON.stringify(records));
      db.update(eventColdChunks)
        .set({
          payload: zstdCompressSync(json, {
            params: { [constants.ZSTD_c_compressionLevel]: 3 },
          }),
          uncompressedBytes: json.length,
        })
        .where(eq(eventColdChunks.id, chunk.id))
        .run();
    }
    expect(() => listEvents(db, { threadId: thread.id })).toThrow(
      ColdEventChunkVerifyError,
    );
  });
});
