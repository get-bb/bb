import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { and, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { threadEventItemSchema, threadEventTypeSchema } from "@bb/domain";
import type {
  ThreadEventItemType,
  ThreadEventScopeKind,
  ThreadEventType,
} from "@bb/domain";
import {
  prepareCachedQuery,
  type DbConnection,
  type DbQueryConnection,
} from "../connection.js";
import { createColdEventChunkId } from "../ids.js";
import { eventColdChunks, events } from "../schema.js";
import { bumpThreadEventRewriteGeneration } from "./event-rewrite-generation.js";
import { getAppSettings } from "./app-settings.js";
import { truncatedEventDataColumn } from "./event-output-truncation.js";
import { prepareCompletedEventOutputData } from "./retained-event-outputs.js";

export const COLD_EVENT_CODEC = "zstd-3";
export const COLD_EVENT_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const COLD_EVENT_CHUNK_TARGET_BYTES = 256 * 1024;
export const COLD_EVENT_PASS_BYTE_BUDGET = 8 * 1024 * 1024;
const ZSTD_LEVEL = 3;
const DELETE_BATCH = 200;
const STEADY_OPEN_SAMPLES = 3;

export const COLD_EVENT_EXCLUDED_TYPES = [
  "provider/rateLimits/updated",
  "provider.env-resolved",
  "provider/unhandled",
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
  "turn/diff/updated",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/plan/delta",
  "item/backgroundTask/progress",
] as const satisfies readonly ThreadEventType[];

export class ColdEventChunkVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColdEventChunkVerifyError";
  }
}

export interface ColdEventRecord {
  createdAt: number;
  data: string;
  environmentId: string | null;
  id: string;
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  parentToolCallId: string | null;
  providerThreadId: string | null;
  scopeKind: ThreadEventScopeKind;
  sequence: number;
  threadId: string;
  turnId: string | null;
  type: ThreadEventType;
}

export interface ColdEventRowQuery {
  afterSequence?: number;
  limit?: number;
  order?: "asc" | "desc";
  beforeSequence?: number;
  excludedTypes?: readonly string[];
  itemIds?: readonly string[];
  itemKinds?: readonly string[];
  maxInlineOutputChars?: number | null;
  parentToolCallIds?: readonly string[];
  predicate?: (event: ColdEventRecord) => boolean;
  sequenceStart?: number;
  threadId: string;
  throughSequence?: number;
  turnId?: string;
  turnIdNull?: boolean;
  turnIds?: readonly string[];
  types?: readonly string[];
}

export interface ColdEventStorageSnapshot {
  chunkBytes: number;
  eventPayloadBytes: number;
  eventRows: number;
  firstOpenMs: number | null;
  steadyOpenMs: number | null;
  storedBytes: number;
  walBytesPerTurn: number | null;
}

export interface ColdEventCompressionResult {
  after: ColdEventStorageSnapshot;
  before: ColdEventStorageSnapshot;
  chunksWritten: number;
  delta: ColdEventStorageSnapshot;
  enabled: true;
  eventsCompressed: number;
  skipped: "busy" | null;
  summary: string;
  threadIds: string[];
  verified: boolean;
}

export interface ColdEventCompressionSkipped {
  enabled: false;
  summary: string;
}

export interface CompressColdThreadEventsArgs {
  encodeChunk?: (json: Buffer) => Buffer;
  limitThreads?: number;
  measureWalBytes?: boolean;
  now: number;
  threadId?: string;
}

interface ChunkDraft {
  events: ColdEventRecord[];
  json: Buffer;
  payload: Buffer;
}

interface DecodedCacheEntry {
  events: ColdEventRecord[];
  signature: string;
  heapBytes: number;
}

interface DecodedCache {
  entries: Map<string, DecodedCacheEntry>;
  heapBytes: number;
}

const DECODED_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const decodedCaches = new WeakMap<DbQueryConnection, DecodedCache>();
const scanCursors = new WeakMap<DbConnection, string>();
const eventScanCursors = new WeakMap<DbConnection, Map<string, number>>();
const compressibleItemKinds = [
  "agentMessage",
  "plan",
  "reasoning",
  "commandExecution",
  "fileChange",
  "toolCall",
  "webFetch",
  "webSearch",
  "imageView",
  "imageGeneration",
  "fileRead",
  "search",
] as const satisfies readonly ThreadEventItemType[];
const itemKinds = threadEventItemSchema.options.map(
  (option) => option.shape.type.value,
);

function cacheFor(db: DbQueryConnection): DecodedCache {
  let cache = decodedCaches.get(db);
  if (!cache) {
    cache = { entries: new Map(), heapBytes: 0 };
    decodedCaches.set(db, cache);
  }
  return cache;
}

function isSqliteBusy(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "SQLITE_BUSY"
  );
}

function encodeChunkPayload(json: Buffer): Buffer {
  return zstdCompressSync(json, {
    params: { [constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL },
  });
}

function verifyChunkPayload(
  json: Buffer,
  payload: Buffer,
  label: string,
): void {
  try {
    const decoded = zstdDecompressSync(payload);
    if (decoded.length !== json.length || !decoded.equals(json)) {
      throw new ColdEventChunkVerifyError(
        `Cold event chunk ${label} did not round-trip`,
      );
    }
  } catch (error) {
    if (error instanceof ColdEventChunkVerifyError) throw error;
    throw new ColdEventChunkVerifyError(
      `Cold event chunk ${label} failed verification`,
    );
  }
}

function emptySnapshot(): ColdEventStorageSnapshot {
  return {
    chunkBytes: 0,
    eventPayloadBytes: 0,
    eventRows: 0,
    firstOpenMs: null,
    steadyOpenMs: null,
    storedBytes: 0,
    walBytesPerTurn: null,
  };
}

function subtractSnapshots(
  before: ColdEventStorageSnapshot,
  after: ColdEventStorageSnapshot,
): ColdEventStorageSnapshot {
  return {
    chunkBytes: after.chunkBytes - before.chunkBytes,
    eventPayloadBytes: after.eventPayloadBytes - before.eventPayloadBytes,
    eventRows: after.eventRows - before.eventRows,
    firstOpenMs:
      before.firstOpenMs === null || after.firstOpenMs === null
        ? null
        : after.firstOpenMs - before.firstOpenMs,
    steadyOpenMs:
      before.steadyOpenMs === null || after.steadyOpenMs === null
        ? null
        : after.steadyOpenMs - before.steadyOpenMs,
    storedBytes: after.storedBytes - before.storedBytes,
    walBytesPerTurn:
      before.walBytesPerTurn === null || after.walBytesPerTurn === null
        ? null
        : after.walBytesPerTurn - before.walBytesPerTurn,
  };
}

function formatMeasure(value: number | null, digits = 0): string {
  if (value === null) return "not measured";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatChange(value: number | null, digits = 0): string {
  if (value === null) return "not measured";
  const formatted = formatMeasure(Math.abs(value), digits);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatMeasure(0, digits);
}

export function formatColdEventCompressionReport(args: {
  after: ColdEventStorageSnapshot;
  before: ColdEventStorageSnapshot;
  chunksWritten: number;
  delta: ColdEventStorageSnapshot;
  eventsCompressed: number;
  skipped: "busy" | null;
  threadIds: string[];
  verified: boolean;
}): string {
  const storageRows = [
    `| Event rows | ${formatMeasure(args.before.eventRows)} | ${formatMeasure(args.after.eventRows)} | ${formatChange(args.delta.eventRows)} |`,
    `| Event payload bytes | ${formatMeasure(args.before.eventPayloadBytes)} | ${formatMeasure(args.after.eventPayloadBytes)} | ${formatChange(args.delta.eventPayloadBytes)} |`,
    `| Chunk bytes | ${formatMeasure(args.before.chunkBytes)} | ${formatMeasure(args.after.chunkBytes)} | ${formatChange(args.delta.chunkBytes)} |`,
    `| Stored bytes | ${formatMeasure(args.before.storedBytes)} | ${formatMeasure(args.after.storedBytes)} | ${formatChange(args.delta.storedBytes)} |`,
  ];
  if (args.before.storedBytes > 0) {
    const percent =
      ((args.before.storedBytes - args.after.storedBytes) /
        args.before.storedBytes) *
      100;
    storageRows.push(`| Stored change |  |  | ${formatMeasure(percent, 1)}% |`);
  }
  const speedRows = [
    `| First open (ms) | ${formatMeasure(args.before.firstOpenMs, 1)} | ${formatMeasure(args.after.firstOpenMs, 1)} | ${formatChange(args.delta.firstOpenMs, 1)} |`,
    `| Steady open (ms) | ${formatMeasure(args.before.steadyOpenMs, 1)} | ${formatMeasure(args.after.steadyOpenMs, 1)} | ${formatChange(args.delta.steadyOpenMs, 1)} |`,
    `| WAL bytes per turn | ${formatMeasure(args.before.walBytesPerTurn)} | ${formatMeasure(args.after.walBytesPerTurn)} | ${formatChange(args.delta.walBytesPerTurn)} |`,
  ];
  return [
    "Cold event compression",
    "",
    "Storage",
    "",
    ...markdownTable(storageRows),
    "",
    "Speed",
    "",
    ...markdownTable(speedRows),
    "",
    `Threads: ${args.threadIds.length === 0 ? "none" : args.threadIds.join(", ")}`,
    `Chunks written: ${args.chunksWritten}`,
    `Events compressed: ${args.eventsCompressed}`,
    `Verified: ${args.verified ? "yes" : "no"}`,
    `Skipped: ${args.skipped ?? "no"}`,
    "First open is one read of the thread bodies. After compression, that read decodes the zstd chunks.",
    "Steady open is the median of the next 3 reads.",
    "WAL bytes per turn is the size of one committed event write. It is not turn latency.",
    "Rewind snapshots: not read or written",
    "Turn path: compression does not run while appending an event",
  ].join("\n");
}

function markdownTable(rows: readonly string[]): string[] {
  return [
    "| Measure | Before | After | Change |",
    "| --- | ---: | ---: | ---: |",
    ...rows,
  ];
}

function databasePath(db: DbConnection): string | null {
  const name = db.$client.name;
  if (typeof name !== "string" || name.length === 0 || name === ":memory:") {
    return null;
  }
  return name;
}

function walFileBytes(db: DbConnection): number | null {
  const path = databasePath(db);
  if (path === null) return null;
  try {
    return statSync(`${path}-wal`).size;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return 0;
    }
    throw error;
  }
}

function measureWalBytesPerTurn(
  db: DbConnection,
  threadId: string,
): number | null {
  if (databasePath(db) === null) return null;
  const sqlite = db.$client;
  const maxSequence =
    sqlite
      .prepare<[string, string], { maxSequence: number | null }>(
        `SELECT MAX(sequence) AS maxSequence FROM (
           SELECT sequence FROM events WHERE thread_id = ?
           UNION ALL
           SELECT seq_end AS sequence FROM event_cold_chunks WHERE thread_id = ?
         )`,
      )
      .get(threadId, threadId)?.maxSequence ?? 0;
  sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const before = walFileBytes(db) ?? 0;
  const id = `evt_wal_probe_${maxSequence + 1}`;
  let committed = false;
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite
      .prepare(
        `INSERT INTO events (
           id, thread_id, scope_kind, sequence, type, data, created_at
         ) VALUES (?, ?, 'thread', ?, 'system/thread/interrupted', ?, ?)`,
      )
      .run(id, threadId, maxSequence + 1, '{"reason":"wal-probe"}', Date.now());
    sqlite.exec("COMMIT");
    committed = true;
    return Math.max(0, (walFileBytes(db) ?? 0) - before);
  } finally {
    if (!committed) sqlite.exec("ROLLBACK");
    sqlite.prepare(`DELETE FROM events WHERE id = ?`).run(id);
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}

function listCandidateThreadIds(
  db: DbConnection,
  args: CompressColdThreadEventsArgs,
  scanLimit: number,
): string[] {
  const cursor = args.threadId === undefined ? (scanCursors.get(db) ?? "") : "";
  const rows = db
    .select({ id: sql<string>`threads.id` })
    .from(sql`threads`)
    .where(
      and(
        sql`deleted_at IS NULL`,
        sql`status IN ('idle', 'error')`,
        sql`updated_at <= ${args.now - COLD_EVENT_IDLE_MS}`,
        args.threadId === undefined
          ? sql`id > ${cursor}`
          : sql`id = ${args.threadId}`,
      ),
    )
    .orderBy(sql`id`)
    .limit(scanLimit)
    .all();
  if (args.threadId === undefined && rows.length === 0) scanCursors.delete(db);
  return rows.map((row) => row.id);
}

interface EventSelectRow {
  created_at: number;
  data: string;
  environment_id: string | null;
  id: string;
  item_id: string | null;
  item_kind: ThreadEventItemType | null;
  parent_tool_call_id: string | null;
  provider_thread_id: string | null;
  scope_kind: ThreadEventScopeKind;
  sequence: number;
  thread_id: string;
  turn_id: string | null;
  type: ThreadEventType;
}

function rowToRecord(row: EventSelectRow): ColdEventRecord {
  return {
    createdAt: row.created_at,
    data: row.data,
    environmentId: row.environment_id,
    id: row.id,
    itemId: row.item_id,
    itemKind: row.item_kind,
    parentToolCallId: row.parent_tool_call_id,
    providerThreadId: row.provider_thread_id,
    scopeKind: row.scope_kind,
    sequence: row.sequence,
    threadId: row.thread_id,
    turnId: row.turn_id,
    type: row.type,
  };
}

function listEligibleEvents(
  db: DbConnection,
  threadId: string,
  budget: { bytes: number; rows: number },
): ColdEventRecord[] {
  let cursors = eventScanCursors.get(db);
  if (!cursors) {
    cursors = new Map();
    eventScanCursors.set(db, cursors);
  }
  const cursor = cursors.get(threadId) ?? 0;
  const candidates = db.$client
    .prepare<
      [string, number, number],
      { id: string; sequence: number; bytes: number }
    >(
      `SELECT candidate.id, candidate.sequence, bb_text_bytes(candidate.data) AS bytes
       FROM events AS candidate
       WHERE thread_id = ? AND sequence > ?
         AND type = 'item/completed'
         AND item_kind IN (${quoteList(compressibleItemKinds)})
         AND sequence < (
           SELECT MAX(sequence) FROM events
           WHERE thread_id = candidate.thread_id AND type = 'item/completed'
         )
         AND NOT EXISTS (
           SELECT 1 FROM retained_event_outputs
           WHERE event_id = candidate.id
         )
       ORDER BY sequence ASC LIMIT ?`,
    )
    .all(threadId, cursor, budget.rows + 1);
  const statement = db.$client.prepare<[string], EventSelectRow>(
    `SELECT
       id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id,
       sequence, type, item_id, item_kind, parent_tool_call_id, bb_text(data) AS data, created_at
     FROM events WHERE id = ?`,
  );
  const eligible: ColdEventRecord[] = [];
  let lastSequence = cursor;
  let complete = true;
  for (const candidate of candidates) {
    if (budget.rows === 0) {
      complete = false;
      break;
    }
    budget.rows--;
    if (candidate.bytes > COLD_EVENT_PASS_BYTE_BUDGET) {
      lastSequence = candidate.sequence;
      continue;
    }
    if (candidate.bytes > budget.bytes) {
      complete = false;
      break;
    }
    budget.bytes -= candidate.bytes;
    lastSequence = candidate.sequence;
    const row = statement.get(candidate.id);
    if (!row) continue;
    const record = rowToRecord(row);
    if (
      prepareCompletedEventOutputData({
        createdAt: record.createdAt,
        data: record.data,
        itemKind: record.itemKind,
        type: record.type,
      }).retainedOutput !== null
    )
      continue;
    const bytes = Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
    if (bytes + 2 <= COLD_EVENT_PASS_BYTE_BUDGET) eligible.push(record);
  }
  if (complete) cursors.delete(threadId);
  else cursors.set(threadId, lastSequence);
  return eligible;
}

function buildDrafts(
  records: readonly ColdEventRecord[],
  encode: (json: Buffer) => Buffer,
): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  let batch: ColdEventRecord[] = [];
  let batchBytes = 2;
  let consumed = 0;

  const flush = (): boolean => {
    if (batch.length === 0) return true;
    const json = Buffer.from(JSON.stringify(batch), "utf8");
    const payload = encode(json);
    verifyChunkPayload(json, payload, `${batch[0]?.sequence ?? 0}`);
    const inlineBytes = batch.reduce(
      (total, event) => total + Buffer.byteLength(event.data, "utf8"),
      0,
    );
    if (payload.length < inlineBytes) {
      drafts.push({ events: batch, json, payload });
      consumed += json.length;
    }
    batch = [];
    batchBytes = 2;
    return consumed < COLD_EVENT_PASS_BYTE_BUDGET;
  };

  for (const record of records) {
    const recordBytes = Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
    if (
      batch.length > 0 &&
      batchBytes + recordBytes > COLD_EVENT_CHUNK_TARGET_BYTES
    ) {
      if (!flush()) return drafts;
    }
    if (consumed >= COLD_EVENT_PASS_BYTE_BUDGET && batch.length === 0) {
      break;
    }
    batch.push(record);
    batchBytes += recordBytes;
  }
  flush();
  return drafts;
}

function publishDrafts(
  db: DbConnection,
  threadId: string,
  drafts: readonly ChunkDraft[],
  createdAt: number,
): void {
  const ids = drafts.flatMap((draft) => draft.events.map((event) => event.id));
  const timeout: unknown = db.$client.pragma("busy_timeout", { simple: true });
  if (typeof timeout !== "number") {
    throw new Error("Invalid SQLite busy timeout");
  }
  db.$client.pragma("busy_timeout = 0");
  try {
    db.transaction((tx) => {
      for (const draft of drafts) {
        const sequences = draft.events.map((event) => event.sequence);
        tx.insert(eventColdChunks)
          .values({
            codec: COLD_EVENT_CODEC,
            createdAt,
            eventCount: draft.events.length,
            id: createColdEventChunkId(),
            itemIds: [
              ...new Set(
                draft.events.flatMap((event) =>
                  event.itemId === null ? [] : [event.itemId],
                ),
              ),
            ].sort(),
            payload: draft.payload,
            seqEnd: Math.max(...sequences),
            seqStart: Math.min(...sequences),
            threadId,
            uncompressedBytes: draft.json.length,
          })
          .run();
      }
      for (let index = 0; index < ids.length; index += DELETE_BATCH) {
        tx.delete(events)
          .where(inArray(events.id, ids.slice(index, index + DELETE_BATCH)))
          .run();
      }
    });
    bumpThreadEventRewriteGeneration(threadId);
  } finally {
    db.$client.pragma(`busy_timeout = ${timeout}`);
  }
}

function snapshotThreads(
  db: DbConnection,
  threadIds: readonly string[],
  measureWalBytes: boolean,
): ColdEventStorageSnapshot {
  if (threadIds.length === 0) return emptySnapshot();
  const placeholders = threadIds.map(() => "?").join(", ");
  const payload = db.$client
    .prepare<[...string[]], { bytes: number; rows: number }>(
      `SELECT
         COALESCE(SUM(octet_length(data)), 0) AS bytes,
         COUNT(*) AS rows
       FROM events
       WHERE thread_id IN (${placeholders})`,
    )
    .get(...threadIds);
  const chunks = db.$client
    .prepare<[...string[]], { bytes: number }>(
      `SELECT COALESCE(SUM(octet_length(payload)), 0) AS bytes
       FROM event_cold_chunks
       WHERE thread_id IN (${placeholders})`,
    )
    .get(...threadIds);
  const eventPayloadBytes = payload?.bytes ?? 0;
  const chunkBytes = chunks?.bytes ?? 0;
  const open = measureWalBytes
    ? measureOpenTimes(db, threadIds)
    : { firstOpenMs: null, steadyOpenMs: null };
  return {
    chunkBytes,
    eventPayloadBytes,
    eventRows: payload?.rows ?? 0,
    firstOpenMs: open.firstOpenMs,
    steadyOpenMs: open.steadyOpenMs,
    storedBytes: eventPayloadBytes + chunkBytes,
    walBytesPerTurn: measureWalBytes
      ? measureWalBytesPerTurn(db, threadIds[0] ?? "")
      : null,
  };
}

function measureOpenTimes(
  db: DbConnection,
  threadIds: readonly string[],
): { firstOpenMs: number; steadyOpenMs: number } {
  const previous = decodedCaches.get(db);
  decodedCaches.set(db, { entries: new Map(), heapBytes: 0 });
  try {
    const firstOpenMs = timeThreadBodyRead(db, threadIds);
    const samples: number[] = [];
    for (let index = 0; index < STEADY_OPEN_SAMPLES; index += 1)
      samples.push(timeThreadBodyRead(db, threadIds));
    return { firstOpenMs, steadyOpenMs: median(samples) };
  } finally {
    if (previous) decodedCaches.set(db, previous);
    else decodedCaches.delete(db);
  }
}

function timeThreadBodyRead(
  db: DbConnection,
  threadIds: readonly string[],
): number {
  const started = performance.now();
  const bytes = readThreadBodyBytes(db, threadIds);
  if (bytes < 0) {
    throw new Error("Cold event open measurement underflow");
  }
  return performance.now() - started;
}

function readThreadBodyBytes(
  db: DbConnection,
  threadIds: readonly string[],
): number {
  let total = 0;
  for (const threadId of threadIds) {
    const inline = db
      .select({ data: events.data })
      .from(events)
      .where(eq(events.threadId, threadId))
      .all();
    const cold = selectColdEventRecords(db, { threadId });
    for (const row of inline) total += row.data.length;
    for (const row of cold) total += row.data.length;
  }
  return total;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function resultFrom(args: {
  after: ColdEventStorageSnapshot;
  before: ColdEventStorageSnapshot;
  chunksWritten: number;
  eventsCompressed: number;
  skipped: "busy" | null;
  threadIds: string[];
  verified: boolean;
}): ColdEventCompressionResult {
  const delta = subtractSnapshots(args.before, args.after);
  const summary = formatColdEventCompressionReport({ ...args, delta });
  return { ...args, delta, enabled: true, summary };
}

export function compressColdThreadEvents(
  db: DbConnection,
  args: CompressColdThreadEventsArgs,
): ColdEventCompressionResult {
  const measureWalBytes = args.measureWalBytes === true;
  const encode = args.encodeChunk ?? encodeChunkPayload;
  const publishLimit = args.limitThreads ?? 1;
  const scanLimit =
    args.threadId === undefined ? Math.max(publishLimit, 32) : publishLimit;
  const plans: Array<{ drafts: ChunkDraft[]; threadId: string }> = [];
  const budget = { bytes: COLD_EVENT_PASS_BYTE_BUDGET, rows: 256 };
  for (const threadId of listCandidateThreadIds(db, args, scanLimit)) {
    if (budget.bytes === 0 || budget.rows === 0) break;
    if (args.threadId === undefined) scanCursors.set(db, threadId);
    const eligible = listEligibleEvents(db, threadId, budget);
    if (eligible.length === 0) continue;
    const drafts = buildDrafts(eligible, encode);
    if (drafts.length === 0) continue;
    plans.push({ drafts, threadId });
    if (plans.length >= publishLimit) break;
  }
  const threadIds = plans.map((plan) => plan.threadId);
  const before = snapshotThreads(db, threadIds, measureWalBytes);
  if (plans.length === 0) {
    return resultFrom({
      after: before,
      before,
      chunksWritten: 0,
      eventsCompressed: 0,
      skipped: null,
      threadIds,
      verified: true,
    });
  }

  let chunksWritten = 0;
  let eventsCompressed = 0;
  try {
    for (const plan of plans) {
      publishDrafts(db, plan.threadId, plan.drafts, args.now);
      chunksWritten += plan.drafts.length;
      eventsCompressed += plan.drafts.reduce(
        (total, draft) => total + draft.events.length,
        0,
      );
    }
  } catch (error) {
    if (!isSqliteBusy(error)) throw error;
    const after = snapshotThreads(db, threadIds, measureWalBytes);
    return resultFrom({
      after,
      before,
      chunksWritten,
      eventsCompressed,
      skipped: "busy",
      threadIds,
      verified: false,
    });
  }

  const after = snapshotThreads(db, threadIds, measureWalBytes);
  return resultFrom({
    after,
    before,
    chunksWritten,
    eventsCompressed,
    skipped: null,
    threadIds,
    verified: true,
  });
}

export function measureColdEventCompression(
  db: DbConnection,
  args: Omit<CompressColdThreadEventsArgs, "measureWalBytes">,
): ColdEventCompressionResult {
  return compressColdThreadEvents(db, { ...args, measureWalBytes: true });
}

export function runColdEventCompressionMaintenance(
  db: DbConnection,
  args: CompressColdThreadEventsArgs,
): ColdEventCompressionResult | ColdEventCompressionSkipped {
  if (!getAppSettings(db).coldEventCompression) {
    return {
      enabled: false,
      summary:
        "Cold event compression is off. Set coldEventCompression to true to run the background worker.",
    };
  }
  return compressColdThreadEvents(db, args);
}

const coldChunkFields = {
  id: eventColdChunks.id,
  threadId: eventColdChunks.threadId,
  seqStart: eventColdChunks.seqStart,
  seqEnd: eventColdChunks.seqEnd,
  eventCount: eventColdChunks.eventCount,
  uncompressedBytes: eventColdChunks.uncompressedBytes,
  codec: eventColdChunks.codec,
  payload: eventColdChunks.payload,
  createdAt: eventColdChunks.createdAt,
  itemIds: sql<unknown>`${eventColdChunks.itemIds}`,
};
type ColdChunk = Omit<typeof eventColdChunks.$inferSelect, "itemIds"> & {
  itemIds: unknown;
};

function parseColdRecord(value: unknown): ColdEventRecord {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid event record");
  const record = value as Record<string, unknown>;
  const nullableString = (field: string): string | null => {
    const value = record[field];
    if (value === null || typeof value === "string") return value;
    throw new Error(`Invalid ${field}`);
  };
  const requiredString = (field: string): string => {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return value;
    throw new Error(`Invalid ${field}`);
  };
  const sequence = record.sequence;
  const createdAt = record.createdAt;
  if (
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    typeof createdAt !== "number" ||
    !Number.isSafeInteger(createdAt)
  )
    throw new Error("Invalid event coordinates");
  const scopeKind = record.scopeKind;
  const turnId = nullableString("turnId");
  if (
    (scopeKind !== "thread" && scopeKind !== "turn") ||
    (scopeKind === "thread" ? turnId !== null : turnId === null)
  )
    throw new Error("Invalid event scope");
  const itemKind =
    record.itemKind === null
      ? null
      : itemKinds.find((kind) => kind === record.itemKind);
  if (itemKind === undefined) throw new Error("Invalid item kind");
  const data = requiredString("data");
  JSON.parse(data);
  const type = threadEventTypeSchema.parse(record.type);
  if (
    type !== "item/completed" ||
    itemKind === null ||
    !compressibleItemKinds.some((kind) => kind === itemKind)
  )
    throw new Error("Invalid compressed event kind");
  return {
    id: requiredString("id"),
    threadId: requiredString("threadId"),
    environmentId: nullableString("environmentId"),
    providerThreadId: nullableString("providerThreadId"),
    itemId: nullableString("itemId"),
    parentToolCallId: nullableString("parentToolCallId"),
    type,
    itemKind,
    scopeKind,
    turnId,
    data,
    sequence,
    createdAt,
  };
}

function decodeChunk(
  db: DbQueryConnection,
  chunk: ColdChunk,
): ColdEventRecord[] {
  const cache = cacheFor(db);
  const signature = createHash("sha256")
    .update(chunk.payload)
    .update(
      JSON.stringify([
        chunk.threadId,
        chunk.seqStart,
        chunk.seqEnd,
        chunk.eventCount,
        chunk.uncompressedBytes,
        chunk.codec,
        chunk.itemIds,
      ]),
    )
    .digest("hex");
  const cached = cache.entries.get(chunk.id);
  if (cached?.signature === signature) {
    cache.entries.delete(chunk.id);
    cache.entries.set(chunk.id, cached);
    return cached.events;
  }
  let records: ColdEventRecord[];
  try {
    if (
      chunk.codec !== COLD_EVENT_CODEC ||
      !Number.isSafeInteger(chunk.uncompressedBytes) ||
      chunk.uncompressedBytes < 2 ||
      chunk.uncompressedBytes > COLD_EVENT_PASS_BYTE_BUDGET ||
      !Number.isSafeInteger(chunk.eventCount) ||
      chunk.eventCount < 1
    )
      throw new Error("Invalid chunk metadata");
    if (typeof chunk.itemIds !== "string")
      throw new Error("Invalid chunk item index");
    const indexedItems: unknown = JSON.parse(chunk.itemIds);
    const json = zstdDecompressSync(chunk.payload, {
      maxOutputLength: chunk.uncompressedBytes,
    });
    if (json.length !== chunk.uncompressedBytes)
      throw new Error("Invalid chunk length");
    const parsed: unknown = JSON.parse(json.toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== chunk.eventCount)
      throw new Error("Invalid chunk records");
    records = parsed.map(parseColdRecord);
    const ids = new Set<string>();
    let previousSequence = 0;
    for (const event of records) {
      if (
        event.threadId !== chunk.threadId ||
        event.sequence <= previousSequence ||
        ids.has(event.id)
      )
        throw new Error("Invalid chunk ownership or ordering");
      ids.add(event.id);
      previousSequence = event.sequence;
    }
    const recordItems = [
      ...new Set(
        records.flatMap((event) =>
          event.itemId === null ? [] : [event.itemId],
        ),
      ),
    ].sort();
    if (
      records[0]?.sequence !== chunk.seqStart ||
      records.at(-1)?.sequence !== chunk.seqEnd ||
      JSON.stringify(recordItems) !== JSON.stringify(indexedItems)
    )
      throw new Error("Invalid chunk index");
  } catch {
    throw new ColdEventChunkVerifyError(
      `Cold event chunk ${chunk.id} failed verification`,
    );
  }
  if (cached) {
    cache.heapBytes -= cached.heapBytes;
    cache.entries.delete(chunk.id);
  }
  const heapBytes = chunk.uncompressedBytes * 3 + records.length * 512;
  if (heapBytes <= DECODED_CACHE_MAX_BYTES) {
    while (cache.heapBytes + heapBytes > DECODED_CACHE_MAX_BYTES) {
      const first = cache.entries.entries().next().value;
      if (!first) break;
      cache.entries.delete(first[0]);
      cache.heapBytes -= first[1].heapBytes;
    }
    cache.entries.set(chunk.id, { events: records, signature, heapBytes });
    cache.heapBytes += heapBytes;
  }
  return records;
}

export function threadHasColdChunks(
  db: DbQueryConnection,
  threadId: string,
): boolean {
  return (
    db
      .select({ id: eventColdChunks.id })
      .from(eventColdChunks)
      .where(eq(eventColdChunks.threadId, threadId))
      .limit(1)
      .get() !== undefined
  );
}

export function deleteColdEventSuffix(
  db: DbQueryConnection,
  args: {
    threadId: string;
    cutoffSequence: number;
    oldMaxSequence: number;
  },
): number {
  const chunks = db
    .select(coldChunkFields)
    .from(eventColdChunks)
    .where(
      and(
        eq(eventColdChunks.threadId, args.threadId),
        gte(eventColdChunks.seqEnd, args.cutoffSequence),
        lte(eventColdChunks.seqStart, args.oldMaxSequence),
      ),
    )
    .all();
  let removed = 0;
  const restore = (chunk: ColdChunk, records: readonly ColdEventRecord[]) => {
    for (const record of records) db.insert(events).values(record).run();
    db.delete(eventColdChunks).where(eq(eventColdChunks.id, chunk.id)).run();
  };
  for (const chunk of chunks) {
    const records = decodeChunk(db, chunk);
    const kept = records.filter(
      (event) =>
        event.sequence < args.cutoffSequence ||
        event.sequence > args.oldMaxSequence,
    );
    removed += records.length - kept.length;
    restore(chunk, kept);
  }
  const latest = db
    .select(coldChunkFields)
    .from(eventColdChunks)
    .where(eq(eventColdChunks.threadId, args.threadId))
    .orderBy(desc(eventColdChunks.seqEnd))
    .limit(1)
    .get();
  if (latest) {
    const inline = db
      .select({ sequence: events.sequence })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "item/completed"),
        ),
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get();
    if (!inline || inline.sequence < latest.seqEnd)
      restore(latest, decodeChunk(db, latest));
  }
  return removed;
}

const prepareInlineOutputTruncation = (db: DbQueryConnection) =>
  db
    .select({
      data: truncatedEventDataColumn(
        sql`${sql.placeholder("maxChars")}`,
        sql<string>`source.data`,
      ),
    })
    .from(sql`(SELECT ${sql.placeholder("data")} AS data) AS source`)
    .prepare();

function truncateInlineOutputs(
  db: DbQueryConnection,
  data: string,
  maxChars: number,
): string {
  if (data.length <= maxChars) return data;
  const row = prepareCachedQuery(db, prepareInlineOutputTruncation).get({
    data,
    maxChars,
  });
  if (!row) throw new Error("Missing truncated cold event data");
  return row.data;
}

function matchesQuery(
  event: ColdEventRecord,
  query: ColdEventRowQuery,
): boolean {
  if (
    query.afterSequence !== undefined &&
    event.sequence <= query.afterSequence
  ) {
    return false;
  }
  if (
    query.sequenceStart !== undefined &&
    event.sequence < query.sequenceStart
  ) {
    return false;
  }
  if (
    query.beforeSequence !== undefined &&
    event.sequence >= query.beforeSequence
  ) {
    return false;
  }
  if (
    query.throughSequence !== undefined &&
    event.sequence > query.throughSequence
  ) {
    return false;
  }
  if (query.types !== undefined && !query.types.includes(event.type)) {
    return false;
  }
  if (
    query.excludedTypes !== undefined &&
    query.excludedTypes.includes(event.type)
  ) {
    return false;
  }
  if (query.turnId !== undefined && event.turnId !== query.turnId) {
    return false;
  }
  if (query.turnIdNull === true && event.turnId !== null) return false;
  if (query.turnIds !== undefined) {
    if (event.turnId === null || !query.turnIds.includes(event.turnId)) {
      return false;
    }
  }
  if (query.itemIds !== undefined) {
    if (event.itemId === null || !query.itemIds.includes(event.itemId)) {
      return false;
    }
  }
  if (
    query.itemKinds !== undefined &&
    (event.itemKind === null || !query.itemKinds.includes(event.itemKind))
  ) {
    return false;
  }
  if (query.parentToolCallIds !== undefined) {
    if (
      event.parentToolCallId === null ||
      !query.parentToolCallIds.includes(event.parentToolCallId)
    ) {
      return false;
    }
  }
  if (query.predicate !== undefined && !query.predicate(event)) return false;
  return true;
}

export function selectColdEventRecords(
  db: DbQueryConnection,
  query: ColdEventRowQuery,
): ColdEventRecord[] {
  const descending = query.order === "desc";
  if (
    query.limit === 0 ||
    (query.types !== undefined && !query.types.includes("item/completed")) ||
    query.excludedTypes?.includes("item/completed") ||
    (query.itemKinds !== undefined &&
      !compressibleItemKinds.some((kind) => query.itemKinds?.includes(kind)))
  )
    return [];
  const chunks = db
    .select({
      id: eventColdChunks.id,
      seqStart: eventColdChunks.seqStart,
      seqEnd: eventColdChunks.seqEnd,
    })
    .from(eventColdChunks)
    .where(
      and(
        eq(eventColdChunks.threadId, query.threadId),
        query.afterSequence === undefined
          ? undefined
          : gt(eventColdChunks.seqEnd, query.afterSequence),
        query.sequenceStart === undefined
          ? undefined
          : gte(eventColdChunks.seqEnd, query.sequenceStart),
        query.beforeSequence === undefined
          ? undefined
          : lt(eventColdChunks.seqStart, query.beforeSequence),
        query.throughSequence === undefined
          ? undefined
          : lte(eventColdChunks.seqStart, query.throughSequence),
        query.itemIds === undefined
          ? undefined
          : sql`CASE WHEN json_valid(${eventColdChunks.itemIds}) THEN
      CASE WHEN json_type(${eventColdChunks.itemIds}) = 'array' THEN EXISTS (
        SELECT 1 FROM json_each(${eventColdChunks.itemIds}) stored_item
        JOIN json_each(${JSON.stringify(query.itemIds)}) wanted_item ON stored_item.value = wanted_item.value
      ) ELSE 1 END ELSE 1 END`,
      ),
    )
    .orderBy(
      descending ? desc(eventColdChunks.seqEnd) : eventColdChunks.seqStart,
    )
    .all();
  const selected: ColdEventRecord[] = [];
  const compare = (left: ColdEventRecord, right: ColdEventRecord) =>
    descending
      ? right.sequence - left.sequence
      : left.sequence - right.sequence;
  for (const chunk of chunks) {
    const floor =
      query.limit === undefined ? undefined : selected[query.limit - 1];
    if (
      floor &&
      (descending
        ? chunk.seqEnd < floor.sequence
        : chunk.seqStart > floor.sequence)
    )
      break;
    const stored = db
      .select(coldChunkFields)
      .from(eventColdChunks)
      .where(eq(eventColdChunks.id, chunk.id))
      .get();
    if (!stored)
      throw new ColdEventChunkVerifyError(
        `Missing cold event chunk ${chunk.id}`,
      );
    selected.push(
      ...decodeChunk(db, stored).filter((event) => matchesQuery(event, query)),
    );
    selected.sort(compare);
    if (query.limit !== undefined)
      selected.length = Math.min(selected.length, query.limit);
  }
  if (query.maxInlineOutputChars == null) return selected;
  const maxChars = query.maxInlineOutputChars;
  return selected.map((event) => ({
    ...event,
    data: truncateInlineOutputs(db, event.data, maxChars),
  }));
}

export function includeColdEventRows<
  T extends { id: string; sequence: number },
>(
  db: DbQueryConnection,
  query: ColdEventRowQuery & { limit?: number; order?: "asc" | "desc" },
  inline: readonly T[],
  toRow: (event: ColdEventRecord) => T,
): T[] {
  if (query.limit === 0) return [];
  const floor = query.limit === undefined ? undefined : inline[query.limit - 1];
  const coldQuery =
    floor === undefined
      ? query
      : query.order === "desc"
        ? {
            ...query,
            afterSequence: Math.max(query.afterSequence ?? -1, floor.sequence),
          }
        : {
            ...query,
            beforeSequence: Math.min(
              query.beforeSequence ?? Number.MAX_SAFE_INTEGER,
              floor.sequence,
            ),
          };
  const cold = selectColdEventRecords(db, coldQuery);
  const seen = new Set(inline.map((row) => row.id));
  const extra = cold.filter((event) => !seen.has(event.id)).map(toRow);
  const order = query.order ?? "asc";
  const merged = [...inline, ...extra].sort((left, right) =>
    order === "desc"
      ? right.sequence - left.sequence
      : left.sequence - right.sequence,
  );
  return query.limit === undefined ? merged : merged.slice(0, query.limit);
}

export function readColdEventJsonString(
  data: string,
  path: string,
): string | null {
  try {
    let current: unknown = JSON.parse(data);
    for (const part of path.split(".")) {
      if (typeof current !== "object" || current === null) return null;
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === "string" ? current : null;
  } catch {
    return null;
  }
}
