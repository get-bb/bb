import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodeStoredText, encodeStoredText } from "../../src/stored-text.js";
import { noopNotifier } from "../../src/notifier.js";
import { createConnection } from "../../src/connection.js";
import type { DbConnection } from "../../src/connection.js";
import {
  ColdEventChunkVerifyError,
  compressColdThreadEvents,
  getAppSettings,
  getLatestThreadSequence,
  listEvents,
  listStoredTimelineWindowEventRows,
  measureColdEventCompression,
  migrate,
  runColdEventCompressionMaintenance,
  setAppSettings,
} from "../../src/index.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { upsertHost } from "../../src/data/hosts.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const directories: string[] = [];
const connections: DbConnection[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bb-cold-events-"));
  directories.push(dir);
  const db = createConnection(join(dir, "bb.db"));
  connections.push(db);
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, project };
}

function createIdleThread(
  db: DbConnection,
  projectId: string,
  now: number,
  status: "idle" | "active" | "pending" | "starting" = "idle",
  updatedAt = now - 8 * DAY_MS,
) {
  const thread = createThread(db, noopNotifier, {
    projectId,
    providerId: "codex",
  });
  db.$client
    .prepare(`UPDATE threads SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, updatedAt, thread.id);
  return thread;
}

function insertAgentMessages(
  db: DbConnection,
  threadId: string,
  count: number,
  text: string,
) {
  const data = JSON.stringify({ item: { text, type: "agentMessage" } });
  const insert = db.$client.prepare(
    `INSERT INTO events (
      id, thread_id, scope_kind, sequence, type, item_kind, data, created_at
    ) VALUES (?, ?, 'thread', ?, 'item/completed', 'agentMessage', ?, ?)`,
  );
  const createdAt = Date.now();
  const write = db.$client.transaction(() => {
    for (let sequence = 1; sequence <= count; sequence += 1) {
      insert.run(
        `evt_${threadId}_${sequence}`,
        threadId,
        sequence,
        data,
        createdAt,
      );
    }
  });
  write();
  return data;
}

function eventCount(db: DbConnection, threadId: string, type?: string): number {
  const sql = type
    ? `SELECT COUNT(*) AS count FROM events WHERE thread_id = ? AND type = ?`
    : `SELECT COUNT(*) AS count FROM events WHERE thread_id = ?`;
  const row = type
    ? db.$client
        .prepare<[string, string], { count: number }>(sql)
        .get(threadId, type)
    : db.$client.prepare<[string], { count: number }>(sql).get(threadId);
  return row?.count ?? 0;
}

function chunkCount(db: DbConnection, threadId: string): number {
  return (
    db.$client
      .prepare<[string], { count: number }>(
        `SELECT COUNT(*) AS count FROM event_cold_chunks WHERE thread_id = ?`,
      )
      .get(threadId)?.count ?? 0
  );
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.$client.close();
  }
  while (directories.length > 0) {
    const dir = directories.pop();
    if (dir) rmSync(dir, { force: true, recursive: true });
  }
});

describe("cold event compression", () => {
  it("reports before and after for a cold thread", () => {
    const now = Date.now();
    const { db, project } = setup();
    const thread = createIdleThread(db, project.id, now);
    const text = "a".repeat(8 * 1024);
    const data = insertAgentMessages(db, thread.id, 200, text);
    const updatedAt = db.$client
      .prepare<[string], { updated_at: number }>(
        `SELECT updated_at FROM threads WHERE id = ?`,
      )
      .get(thread.id)?.updated_at;

    const result = measureColdEventCompression(db, {
      now,
      threadId: thread.id,
    });

    expect(result.enabled).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.skipped).toBeNull();
    expect(result.eventsCompressed).toBe(199);
    expect(result.chunksWritten).toBeGreaterThan(0);
    expect(result.threadIds).toEqual([thread.id]);
    expect(result.before.eventRows).toBe(200);
    expect(result.after.eventRows).toBe(1);
    expect(result.before.eventPayloadBytes).toBeGreaterThan(1_000_000);
    expect(result.before.storedBytes).toBeGreaterThan(
      result.after.storedBytes * 10,
    );
    expect(result.before.chunkBytes).toBe(0);
    expect(result.after.chunkBytes).toBeGreaterThan(0);
    expect(result.delta.eventRows).toBe(-199);
    expect(result.delta.storedBytes).toBe(
      result.after.storedBytes - result.before.storedBytes,
    );
    expect(Number.isFinite(result.before.firstOpenMs)).toBe(true);
    expect(Number.isFinite(result.after.firstOpenMs)).toBe(true);
    expect(Number.isFinite(result.before.steadyOpenMs)).toBe(true);
    expect(Number.isFinite(result.after.steadyOpenMs)).toBe(true);
    expect(result.before.walBytesPerTurn).toBeGreaterThan(0);
    expect(result.after.walBytesPerTurn).toBeGreaterThan(0);
    expect(result.after.walBytesPerTurn ?? 0).toBeLessThanOrEqual(
      (result.before.walBytesPerTurn ?? 0) + 8192,
    );

    const payloadLine = result.summary
      .split("\n")
      .find((line) => line.startsWith("| Event payload bytes |"));
    expect(payloadLine).toBe(
      `| Event payload bytes | ${result.before.eventPayloadBytes.toLocaleString("en-US")} | ${result.after.eventPayloadBytes.toLocaleString("en-US")} | ${formatChange(result.delta.eventPayloadBytes)} |`,
    );
    expect(result.summary.indexOf("\nStorage\n")).toBeGreaterThan(-1);
    expect(result.summary.indexOf("\nSpeed\n")).toBeGreaterThan(
      result.summary.indexOf("\nStorage\n"),
    );
    expect(result.summary.indexOf("| Stored change |")).toBeLessThan(
      result.summary.indexOf("\nSpeed\n"),
    );
    expect(result.summary.indexOf("| First open (ms) |")).toBeGreaterThan(
      result.summary.indexOf("\nSpeed\n"),
    );
    expect(result.summary).toContain("| Measure | Before | After | Change |");
    expect(result.summary).toContain("| Steady open (ms) |");
    expect(result.summary).toContain("| WAL bytes per turn |");
    expect(result.summary).toContain(
      "First open is one read of the thread bodies. After compression, that read decodes the zstd chunks.",
    );
    expect(result.summary).toContain(
      "Steady open is the median of the next 3 reads.",
    );
    expect(result.summary).toContain(
      "WAL bytes per turn is the size of one committed event write. It is not turn latency.",
    );
    expect(result.summary).toContain("Rewind snapshots: not read or written");
    expect(result.summary).toContain(
      "Turn path: compression does not run while appending an event",
    );
    expect(result.summary).not.toContain("not measured");

    const listed = listEvents(db, { threadId: thread.id });
    expect(listed.map((event) => event.sequence)).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 1),
    );
    expect(listed.every((event) => event.data === data)).toBe(true);
    expect(getLatestThreadSequence(db, { threadId: thread.id })).toBe(200);
    expect(
      db.$client
        .prepare<[string], { updated_at: number }>(
          `SELECT updated_at FROM threads WHERE id = ?`,
        )
        .get(thread.id)?.updated_at,
    ).toBe(updatedAt);
    const window = listStoredTimelineWindowEventRows(db, {
      maxInlineOutputChars: null,
      sequenceStart: 1,
      threadId: thread.id,
    });
    expect(window).toHaveLength(200);
    expect(window[0]?.data).toBe(data);
    expect(window.at(-1)?.sequence).toBe(200);

    const again = compressColdThreadEvents(db, { now, threadId: thread.id });
    expect(again.eventsCompressed).toBe(0);
    expect(chunkCount(db, thread.id)).toBe(result.chunksWritten);
    expect(eventCount(db, thread.id)).toBe(1);
  });

  it("leaves the WAL row unmeasured unless measurement is requested", () => {
    const now = Date.now();
    const { db, project } = setup();
    const thread = createIdleThread(db, project.id, now);
    insertAgentMessages(db, thread.id, 30, "b".repeat(4096));
    const result = compressColdThreadEvents(db, { now, threadId: thread.id });
    const walLine = result.summary
      .split("\n")
      .find((line) => line.startsWith("| WAL bytes per turn |"));
    expect(walLine).toBe(
      "| WAL bytes per turn | not measured | not measured | not measured |",
    );
    expect(result.before.walBytesPerTurn).toBeNull();
    expect(result.after.walBytesPerTurn).toBeNull();
  });

  it.each([DAY_MS, -DAY_MS])(
    "skips young, active, excluded, and retained events at expiry offset %i",
    (expiryOffset) => {
      const now = Date.now();
      const { db, project } = setup();
      const body = "a".repeat(4096);
      const active = createIdleThread(
        db,
        project.id,
        now,
        "active",
        now - 8 * DAY_MS,
      );
      insertAgentMessages(db, active.id, 5, body);
      const pending = createIdleThread(
        db,
        project.id,
        now,
        "pending",
        now - 8 * DAY_MS,
      );
      insertAgentMessages(db, pending.id, 5, body);
      const young = createIdleThread(db, project.id, now, "idle", now);
      insertAgentMessages(db, young.id, 5, body);

      const idle = createIdleThread(db, project.id, now);
      insertAgentMessages(db, idle.id, 4, body);
      db.$client
        .prepare(
          `INSERT INTO events (
          id, thread_id, scope_kind, sequence, type, data, created_at
        ) VALUES (?, ?, 'thread', ?, 'provider/rateLimits/updated', '{}', ?)`,
        )
        .run(`evt_${idle.id}_rate`, idle.id, 5, now);
      db.$client
        .prepare(
          `INSERT INTO events (
          id, thread_id, scope_kind, sequence, type, item_kind, data, created_at
        ) VALUES (?, ?, 'thread', ?, 'item/completed', 'commandExecution', ?, ?)`,
        )
        .run(
          `evt_${idle.id}_retained`,
          idle.id,
          6,
          JSON.stringify({
            item: { aggregatedOutput: "full", type: "commandExecution" },
          }),
          now,
        );
      db.$client
        .prepare(
          `INSERT INTO events (
          id, thread_id, scope_kind, sequence, type, item_kind, data, created_at
        ) VALUES (?, ?, 'thread', ?, 'item/completed', 'commandExecution', '{}', ?)`,
        )
        .run(`evt_${idle.id}_retained_tail`, idle.id, 7, now);
      db.$client
        .prepare(
          `INSERT INTO retained_event_outputs (event_id, output_path, value, expires_at)
         VALUES (?, 'aggregatedOutput', 'full', ?)`,
        )
        .run(`evt_${idle.id}_retained`, now + expiryOffset);

      for (const thread of [active, pending, young]) {
        const skipped = compressColdThreadEvents(db, {
          now,
          threadId: thread.id,
        });
        expect(skipped.eventsCompressed).toBe(0);
        expect(eventCount(db, thread.id)).toBe(5);
        expect(chunkCount(db, thread.id)).toBe(0);
      }

      const result = compressColdThreadEvents(db, { now, threadId: idle.id });
      expect(result.eventsCompressed).toBe(4);
      expect(eventCount(db, idle.id, "provider/rateLimits/updated")).toBe(1);
      expect(eventCount(db, idle.id, "item/completed")).toBe(2);
      const inlineIds = new Set(
        db.$client
          .prepare<[string], { id: string }>(
            `SELECT id FROM events WHERE thread_id = ?`,
          )
          .all(idle.id)
          .map((row) => row.id),
      );
      expect(inlineIds.has(`evt_${idle.id}_retained`)).toBe(true);
      expect(
        db.$client
          .prepare(
            "SELECT value, expires_at FROM retained_event_outputs WHERE event_id = ?",
          )
          .get(`evt_${idle.id}_retained`),
      ).toEqual({ value: "full", expires_at: now + expiryOffset });
      expect(inlineIds.has(`evt_${idle.id}_retained_tail`)).toBe(true);
      expect(inlineIds.has(`evt_${idle.id}_rate`)).toBe(true);
      expect(inlineIds.has(`evt_${idle.id}_1`)).toBe(false);
      expect(listEvents(db, { threadId: idle.id })).toHaveLength(7);
    },
  );

  it("stays off until the setting is enabled", () => {
    const now = Date.now();
    const { db, project } = setup();
    const thread = createIdleThread(db, project.id, now);
    insertAgentMessages(db, thread.id, 8, "c".repeat(2048));
    expect(getAppSettings(db).coldEventCompression).toBe(false);
    const skipped = runColdEventCompressionMaintenance(db, {
      now,
      threadId: thread.id,
    });
    expect(skipped.enabled).toBe(false);
    expect(eventCount(db, thread.id)).toBe(8);
    expect(chunkCount(db, thread.id)).toBe(0);

    setAppSettings(db, { ...getAppSettings(db), coldEventCompression: true });
    const ran = runColdEventCompressionMaintenance(db, {
      limitThreads: 1,
      now,
      threadId: thread.id,
    });
    expect(ran.enabled).toBe(true);
    if (!ran.enabled) return;
    expect(ran.eventsCompressed).toBe(7);
    expect(ran.summary).toContain("| Measure | Before | After | Change |");
    expect(ran.summary).toContain("Rewind snapshots: not read or written");
  });

  it("bounds decoding of skipped legacy outputs and resumes beyond their prefix", () => {
    const now = Date.now();
    const { db, project } = setup();
    const thread = createIdleThread(db, project.id, now);
    insertAgentMessages(db, thread.id, 5, "readable".repeat(300));
    const legacy = JSON.stringify({
      item: {
        type: "commandExecution",
        aggregatedOutput: "legacy".repeat(512 * 1024),
      },
    });
    const encoded = encodeStoredText(legacy);
    expect(encoded).not.toBeNull();
    db.$client
      .prepare(
        "UPDATE events SET item_kind='commandExecution', data=? WHERE thread_id=? AND sequence <= 3",
      )
      .run(encoded, thread.id);
    let decodedBytes = 0;
    db.$client.function("bb_text", { deterministic: true }, (value) => {
      if (value === null) return null;
      const text = decodeStoredText(value);
      decodedBytes += Buffer.byteLength(text);
      return text;
    });
    const first = compressColdThreadEvents(db, { now, threadId: thread.id });
    expect(first.eventsCompressed).toBe(0);
    expect(decodedBytes).toBeGreaterThan(6 * 1024 * 1024);
    expect(decodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    decodedBytes = 0;
    const second = compressColdThreadEvents(db, { now, threadId: thread.id });
    expect(second.eventsCompressed).toBe(1);
    expect(decodedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(listEvents(db, { threadId: thread.id })).toHaveLength(5);
  });

  it("does not delete rows when chunk verification fails", () => {
    const now = Date.now();
    const { db, project } = setup();
    const thread = createIdleThread(db, project.id, now);
    insertAgentMessages(db, thread.id, 12, "d".repeat(2048));
    expect(() =>
      compressColdThreadEvents(db, {
        encodeChunk: (json) => {
          const flipped = Buffer.from(json);
          flipped[0] = flipped[0] === undefined ? 1 : flipped[0] ^ 0xff;
          return flipped;
        },
        now,
        threadId: thread.id,
      }),
    ).toThrow(ColdEventChunkVerifyError);
    expect(eventCount(db, thread.id)).toBe(12);
    expect(chunkCount(db, thread.id)).toBe(0);
  });
});

function formatChange(value: number): string {
  const formatted = Math.abs(value).toLocaleString("en-US");
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0";
}
