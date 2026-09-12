import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  insertEvents,
  listStoredEventRows,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
  type StoredEventRow,
} from "@bb/db";
import {
  clearStoredEventDecodeCache,
  decodeStoredEventRowCached,
  readStoredEventDecodeCacheSize,
  STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS,
  STORED_EVENT_DECODE_CACHE_MAX_ENTRIES,
} from "../../../src/services/threads/stored-event-decode-cache.js";
import { parseStoredEvent } from "../../../src/services/threads/thread-data.js";

let db: DbConnection;
let message: StoredEventRow;
let operation: StoredEventRow;

function agentMessageData(text: string): string {
  return JSON.stringify({
    item: { type: "agentMessage", id: "message-1", text },
  });
}

beforeAll(() => {
  db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "decode-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "decode-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/decode" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  insertEvents(db, noopNotifier, [
    {
      data: agentMessageData("Hello"),
      itemId: "message-1",
      itemKind: "agentMessage",
      parentToolCallId: null,
      providerThreadId: "provider-decode",
      scope: turnScope("turn-1"),
      sequence: 1,
      threadId: thread.id,
      type: "item/completed",
    },
    {
      data: JSON.stringify({
        operation: THREAD_CONTEXT_CLEAR_OPERATION,
        operationId: "clear",
        status: "completed",
        message: "Fresh context",
      }),
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      scope: threadScope(),
      sequence: 2,
      threadId: thread.id,
      type: "system/operation",
    },
  ]);
  const rows = listStoredEventRows(db, { threadId: thread.id });
  message = rows[0]!;
  operation = rows[1]!;
});

beforeEach(() => {
  clearStoredEventDecodeCache(db);
});

afterAll(() => {
  db.$client.close();
});

describe("stored event decode cache", () => {
  it("decodes equal to parseStoredEvent and reuses the decode for the row and a copy", () => {
    for (const row of [message, operation]) {
      const decoded = decodeStoredEventRowCached(db, row);
      expect(decoded).toEqual(parseStoredEvent(row));
      expect(decodeStoredEventRowCached(db, row)).toBe(decoded);
      expect(decodeStoredEventRowCached(db, { ...row })).toBe(decoded);
    }
    expect(readStoredEventDecodeCacheSize(db).entryCount).toBe(2);
  });

  it("decodes again when any parse input of a row changes", () => {
    const variants: [StoredEventRow, StoredEventRow][] = [
      [message, { ...message, data: agentMessageData("Changed") }],
      [message, { ...message, providerThreadId: "provider-other" }],
      [message, { ...message, turnId: "turn-other" }],
      [message, { ...message, threadId: "thr_other" }],
      [message, { ...message, type: "item/started" }],
      [operation, { ...operation, scopeKind: "turn", turnId: "turn-1" }],
    ];
    for (const [row, variant] of variants) {
      const original = decodeStoredEventRowCached(db, row);
      const decoded = decodeStoredEventRowCached(db, variant);
      expect(decoded).not.toBe(original);
      expect(decoded).toEqual(parseStoredEvent(variant));
      expect(decodeStoredEventRowCached(db, { ...row })).toEqual(original);
    }
  });

  it("throws for a row that does not parse and caches nothing", () => {
    const invalid = { ...message, id: "evt_invalid", data: "{not json" };
    const before = readStoredEventDecodeCacheSize(db);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => decodeStoredEventRowCached(db, invalid)).toThrow(
        /is not valid JSON/u,
      );
    }
    expect(readStoredEventDecodeCacheSize(db)).toEqual(before);
  });

  it("freezes cached events while the server suite enables the test seam", () => {
    const frozen = decodeStoredEventRowCached(db, message);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => {
      Object.assign(frozen, { threadId: "mutated" });
    }).toThrow(TypeError);
  });

  it("keeps entries and data characters under the caps while recent rows still hit", () => {
    const rowChars = 20_000;
    const rows = Array.from({ length: 800 }, (_, index) => ({
      ...message,
      data: agentMessageData("x".repeat(rowChars)),
      id: `evt_cap_${index}`,
    }));
    expect(rows.length * rowChars).toBeGreaterThan(
      STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS,
    );
    for (const row of rows) {
      decodeStoredEventRowCached(db, row);
      const size = readStoredEventDecodeCacheSize(db);
      expect(size.dataChars).toBeLessThanOrEqual(
        STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS,
      );
      expect(size.entryCount).toBeLessThanOrEqual(
        STORED_EVENT_DECODE_CACHE_MAX_ENTRIES,
      );
    }
    expect(readStoredEventDecodeCacheSize(db).dataChars).toBeGreaterThan(
      STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS / 4,
    );
    for (const row of rows.slice(-40)) {
      const decoded = decodeStoredEventRowCached(db, { ...row });
      expect(decodeStoredEventRowCached(db, { ...row })).toBe(decoded);
    }
  });
});
