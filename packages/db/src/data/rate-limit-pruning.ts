import { inArray, sql } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { events, threadPruningRateLimitKeepers } from "../schema.js";
import { bumpThreadEventRewriteGeneration } from "./event-rewrite-generation.js";

function candidates(
  db: DbQueryConnection,
  args: { threadId: string; afterSequence: number; throughSequence: number },
) {
  return db.all<{
    id: string;
    sequence: number;
    bytes: number;
    providerId: string | null;
  }>(sql`
    SELECT id, sequence, length(CAST(data AS BLOB)) AS bytes,
      CASE WHEN json_valid(data) THEN CASE WHEN json_type(data, '$.rateLimits.providerId') = 'text' THEN json_extract(data, '$.rateLimits.providerId') END END AS providerId
    FROM events INDEXED BY events_thread_type_sequence_idx
    WHERE thread_id = ${args.threadId} AND type = 'provider/rateLimits/updated'
      AND sequence > ${args.afterSequence} AND sequence <= ${args.throughSequence}
    ORDER BY sequence DESC LIMIT 500
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
  const rows = candidates(db, args);
  const seen = new Set<string>();
  const discard: string[] = [];
  let removedBytes = 0;
  for (const row of rows) {
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
  const removed =
    discard.length === 0
      ? 0
      : db.delete(events).where(inArray(events.id, discard)).run().changes;
  return {
    removed,
    removedBytes,
    scanned: rows.length,
    nextSequence: rows.at(-1)?.sequence ?? 0,
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
