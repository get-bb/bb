import { isBeforeLatestThreadEvent } from "./event-pruning-guards.js";
import { sql } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { bumpThreadEventRewriteGeneration } from "./event-rewrite-generation.js";

export function pruneRateLimitSnapshotWindow(
  db: DbQueryConnection,
  args: {
    threadId: string;
    afterSequence: number;
    throughSequence: number;
    limit?: number;
  },
) {
  const rows = db.all<{ id: string; sequence: number }>(sql`
    SELECT id, sequence FROM events INDEXED BY events_thread_type_sequence_idx
    WHERE thread_id = ${args.threadId} AND type = 'provider/rateLimits/updated'
      AND sequence > ${args.afterSequence} AND sequence <= ${args.throughSequence}
    ORDER BY sequence LIMIT ${args.limit ?? 64}
  `);
  const removed =
    rows.length === 0
      ? 0
      : db.run(sql`
    DELETE FROM events WHERE id IN (${sql.join(
      rows.map((row) => sql`${row.id}`),
      sql`, `,
    )})
      AND ${isBeforeLatestThreadEvent(args.threadId)}
      AND (EXISTS (SELECT 1 FROM threads WHERE id = ${args.threadId} AND archived_at IS NOT NULL)
        OR sequence < (SELECT sequence FROM events WHERE thread_id = ${args.threadId}
          AND type = 'provider/rateLimits/updated' ORDER BY sequence DESC LIMIT 1))
  `).changes;
  return {
    removed,
    scanned: rows.length,
    complete: rows.length < (args.limit ?? 64),
    nextSequence: rows.at(-1)?.sequence ?? args.afterSequence,
  };
}

export function pruneRateLimitSnapshots(
  db: DbConnection,
  args: { threadId: string; afterSequence: number; throughSequence: number },
): number {
  const result = db.transaction(
    (tx) => pruneRateLimitSnapshotWindow(tx, args),
    { behavior: "immediate" },
  );
  if (result.removed > 0) bumpThreadEventRewriteGeneration(args.threadId);
  return result.removed;
}
