import { performance } from "node:perf_hooks";
import { inArray, sql } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { events, threadPruningRateLimitKeepers } from "../schema.js";
import { bumpThreadEventRewriteGeneration } from "./event-rewrite-generation.js";

const MAX_ROWS = 64;
const MAX_SCANNED_BYTES = 1024 * 1024;
const SCAN_BUDGET_MS = 8;

function candidates(
  db: DbQueryConnection,
  args: { threadId: string; afterSequence: number; throughSequence: number },
) {
  return db.all<{ id: string; sequence: number }>(sql`
    SELECT id, sequence FROM events INDEXED BY events_thread_type_sequence_idx
    WHERE thread_id = ${args.threadId} AND type = 'provider/rateLimits/updated'
      AND sequence > ${args.afterSequence} AND sequence <= ${args.throughSequence}
    ORDER BY sequence DESC LIMIT ${MAX_ROWS}
  `);
}

export function pruneRateLimitSnapshotWindow(
  db: DbQueryConnection,
  args: {
    threadId: string;
    afterSequence: number;
    throughSequence: number;
    durable: boolean;
  },
) {
  const startedAt = performance.now();
  const rows = candidates(db, args);
  const seen = new Set<string>();
  const discard: string[] = [];
  let removedBytes = 0;
  let scanned = 0;
  let scannedBytes = 0;
  for (const candidate of rows) {
    if (
      scanned > 0 &&
      (scannedBytes >= MAX_SCANNED_BYTES ||
        performance.now() - startedAt >= SCAN_BUDGET_MS)
    )
      break;
    const payload = db.get<{ bytes: number; providerId: string | null }>(sql`
      SELECT length(CAST(data AS BLOB)) AS bytes,
        CASE WHEN json_valid(data) THEN CASE WHEN json_type(data, '$.rateLimits.providerId') = 'text' THEN json_extract(data, '$.rateLimits.providerId') END END AS providerId
      FROM events WHERE id = ${candidate.id}
    `);
    if (!payload) throw new Error("Missing rate-limit pruning candidate");
    const row = { ...candidate, ...payload };
    scanned += 1;
    scannedBytes += row.bytes;
    if (row.providerId === null || row.providerId.trim().length === 0) continue;
    let superseded = seen.has(row.providerId);
    if (!superseded && args.durable) {
      const witness = db.get<{ sequence: number }>(sql`
        SELECT events.sequence FROM thread_pruning_rate_limit_keepers keeper
        JOIN events ON events.id = keeper.event_id
        WHERE keeper.provider_id = ${row.providerId}
          AND events.thread_id = ${args.threadId} AND events.type = 'provider/rateLimits/updated'
          AND events.sequence > ${row.sequence}
          AND CASE WHEN json_valid(events.data) THEN json_extract(events.data, '$.rateLimits.providerId') END = ${row.providerId}
      `);
      superseded = witness !== undefined;
    }
    if (superseded) {
      discard.push(row.id);
      removedBytes += row.bytes;
    } else if (args.durable) {
      db.insert(threadPruningRateLimitKeepers)
        .values({ providerId: row.providerId, eventId: row.id })
        .onConflictDoUpdate({
          target: threadPruningRateLimitKeepers.providerId,
          set: { eventId: row.id },
        })
        .run();
    }
    seen.add(row.providerId);
  }
  const scanMs = performance.now() - startedAt;
  const deleteStartedAt = performance.now();
  const removed =
    discard.length === 0
      ? 0
      : db.delete(events).where(inArray(events.id, discard)).run().changes;
  return {
    removed,
    removedBytes,
    scanned,
    scannedBytes,
    scanMs,
    deleteMs: performance.now() - deleteStartedAt,
    complete: scanned === rows.length && rows.length < MAX_ROWS,
    nextSequence: rows[scanned - 1]?.sequence ?? 0,
  };
}

export function pruneRateLimitSnapshots(
  db: DbConnection,
  args: { threadId: string; afterSequence: number; throughSequence: number },
): number {
  const result = db.transaction(
    (tx) => pruneRateLimitSnapshotWindow(tx, { ...args, durable: false }),
    { behavior: "immediate" },
  );
  if (result.removed > 0) bumpThreadEventRewriteGeneration(args.threadId);
  return result.removed;
}
