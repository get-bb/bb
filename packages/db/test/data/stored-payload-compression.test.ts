import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { threadScope } from "@bb/domain";
import { createMigratedConnection } from "../../src/testing.js";
import type { DbConnection } from "../../src/connection.js";
import { noopNotifier } from "../../src/notifier.js";
import { events, promptHistoryEntries } from "../../src/schema.js";
import {
  decodeStoredText,
  encodeStoredText,
  StoredTextDecodeError,
} from "../../src/stored-text.js";
import { runStoredPayloadCompressionMaintenance } from "../../src/data/stored-payload-compression.js";
import { getAppSettings, setAppSettings } from "../../src/data/app-settings.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  createThread,
  searchThreadsWithPendingInteractionState,
  updateThread,
  deleteThread,
  upsertThreadSearchSegments,
} from "../../src/data/threads.js";
import { insertEvents, listEvents } from "../../src/data/events.js";
import {
  createPromptHistoryEntry,
  listStoredThreadPromptHistoryRows,
} from "../../src/data/prompt-history.js";
import {
  canHydrateRetainedEventOutputRowsWithinDataByteLimit,
  hydrateRetainedEventOutputRows,
} from "../../src/data/retained-event-outputs.js";

const connections: DbConnection[] = [];
afterEach(() => {
  while (connections.length) connections.pop()?.$client.close();
});

function setup(textRepeats = 2000) {
  const db = createMigratedConnection();
  connections.push(db);
  const host = upsertHost(db, noopNotifier, { name: "storage" });
  const { project } = createProject(db, noopNotifier, {
    name: "storage",
    source: { type: "local_path", hostId: host.id, path: "/tmp/storage" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    title: "compressionneedle",
  });
  const input = [
    {
      type: "text" as const,
      text: "\uFEFF" + "unicode🙂 compressionneedle ".repeat(textRepeats),
      mentions: [],
    },
  ];
  upsertThreadSearchSegments(db, {
    segments: [
      {
        threadId: thread.id,
        sourceKind: "user_message",
        sourceKey: "1",
        sourceSeq: 1,
        text: input[0].text,
      },
    ],
  });
  insertEvents(db, noopNotifier, [
    {
      threadId: thread.id,
      sequence: 1,
      scope: threadScope(),
      type: "client/turn/requested",
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: JSON.stringify({
        initiator: "user",
        input,
        target: { kind: "new-turn" },
      }),
    },
    {
      threadId: thread.id,
      sequence: 2,
      scope: threadScope(),
      type: "item/completed",
      itemId: "command",
      itemKind: "commandExecution",
      parentToolCallId: null,
      data: JSON.stringify({
        item: {
          type: "commandExecution",
          aggregatedOutput: "\uFEFF" + "output🙂".repeat(20_000),
        },
      }),
    },
  ]);
  createPromptHistoryEntry(db, {
    projectId: project.id,
    threadId: thread.id,
    scope: "thread",
    requestSequence: 1,
    input,
  });
  const search = () =>
    searchThreadsWithPendingInteractionState(db, {
      query: "compressionneedle",
      limitPerGroup: 10,
    });
  const history = () =>
    listStoredThreadPromptHistoryRows(db, { threadId: thread.id, limit: 10 });
  const rows = () => listEvents(db, { threadId: thread.id });
  const enable = () =>
    setAppSettings(db, { ...getAppSettings(db), coldEventCompression: true });
  const compress = () => {
    enable();
    for (let pass = 0; pass < 8; pass++)
      runStoredPayloadCompressionMaintenance(db);
  };
  return { db, thread, search, history, rows, enable, compress };
}

describe("stored payload compression", () => {
  it("preserves search, prompt history, output hydration and byte budgets across opt-in and disabling", () => {
    const { db, thread, search, history, rows, compress } = setup();
    const before = {
      search: search(),
      history: history(),
      rows: rows(),
      hydrated: hydrateRetainedEventOutputRows(db, rows()),
    };
    expect(runStoredPayloadCompressionMaintenance(db).enabled).toBe(false);
    compress();
    for (const [table, column] of [
      ["events", "data"],
      ["retained_event_outputs", "value"],
      ["prompt_history_entries", "input"],
      ["thread_search_segments", "text"],
    ])
      expect(
        db.$client
          .prepare<[], { n: number }>(
            `SELECT count(*) n FROM ${table} WHERE typeof(${column})='blob'`,
          )
          .get()?.n,
      ).toBeGreaterThan(0);
    expect(
      db.$client
        .prepare("SELECT typeof(input) kind FROM prompt_history_entries")
        .get(),
    ).toEqual({ kind: "blob" });
    expect({
      search: search(),
      history: history(),
      rows: rows(),
      hydrated: hydrateRetainedEventOutputRows(db, rows()),
    }).toEqual(before);
    expect(
      canHydrateRetainedEventOutputRowsWithinDataByteLimit(db, rows(), 10_000),
    ).toBe(false);
    expect(
      canHydrateRetainedEventOutputRowsWithinDataByteLimit(
        db,
        rows(),
        1_000_000,
      ),
    ).toBe(true);
    setAppSettings(db, { ...getAppSettings(db), coldEventCompression: false });
    expect(history()).toEqual(before.history);
    updateThread(db, noopNotifier, thread.id, { title: "replacementneedle" });
    const replacement = searchThreadsWithPendingInteractionState(db, {
      query: "replacementneedle",
      limitPerGroup: 10,
    });
    expect(replacement.active.total).toBe(1);
    deleteThread(db, noopNotifier, thread.id);
    expect(search().active.total).toBe(0);
  });

  it("makes progress on a single payload larger than the normal pass budget", () => {
    const { db, rows, history, search, compress } = setup(100_000);
    const before = { rows: rows(), history: history(), search: search() };
    compress();
    expect({ rows: rows(), history: history(), search: search() }).toEqual(
      before,
    );
    for (const [table, column] of [
      ["events", "data"],
      ["prompt_history_entries", "input"],
      ["thread_search_segments", "text"],
    ])
      expect(
        db.$client
          .prepare<[], { n: number }>(
            `SELECT count(*) n FROM ${table} WHERE typeof(${column})='blob'`,
          )
          .get()?.n,
      ).toBeGreaterThan(0);
    expect(
      db.$client
        .prepare("SELECT typeof(input) kind FROM prompt_history_entries")
        .get(),
    ).toEqual({ kind: "blob" });
  });

  it("rolls a failed compression batch back and retries without losing any rows", () => {
    const { db, rows, enable, compress } = setup();
    const before = rows();
    enable();
    db.$client.exec(
      "CREATE TRIGGER reject_compression BEFORE UPDATE OF data ON events WHEN typeof(new.data)='blob' BEGIN SELECT RAISE(ABORT, 'blocked compression'); END",
    );
    expect(() => runStoredPayloadCompressionMaintenance(db)).toThrow(
      "blocked compression",
    );
    expect(rows()).toEqual(before);
    db.$client.exec("DROP TRIGGER reject_compression");
    compress();
    expect(rows()).toEqual(before);
    const history = db.select().from(promptHistoryEntries).get();
    expect(history?.input).toContain("unicode🙂");
  });

  it("rejects damaged encoded payloads through the normal event reader", () => {
    const { db, thread, rows, compress } = setup();
    compress();
    const first = db.select().from(events).where(eq(events.sequence, 1)).get();
    if (!first) throw new Error("Missing event");
    const encoded = encodeStoredText(first.data);
    if (!encoded) throw new Error("Missing encoded payload");
    encoded[encoded.length - 1] ^= 1;
    db.$client
      .prepare("UPDATE events SET data=? WHERE id=?")
      .run(encoded, first.id);
    expect(() => rows()).toThrow(StoredTextDecodeError);
    expect(() => listEvents(db, { threadId: thread.id })).toThrow(
      StoredTextDecodeError,
    );
    expect(() => decodeStoredText(Buffer.from("unknown format"))).toThrow(
      StoredTextDecodeError,
    );
  });
});
