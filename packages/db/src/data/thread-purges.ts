import { and, asc, eq, inArray, notExists, notInArray, sql } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { events, threadPurges, threads } from "../schema.js";

const THREAD_PURGE_BATCHED_TABLES = [
  "thread_search_segments",
  "prompt_history_entries",
  "project_attachment_threads",
] as const;

export function requestThreadPurge(
  db: DbQueryConnection,
  args: { now: number; threadId: string },
): void {
  db.insert(threadPurges)
    .values({ requestedAt: args.now, threadId: args.threadId })
    .onConflictDoNothing()
    .run();
}

export function nextThreadPurge(
  db: DbQueryConnection,
  args: { excludedThreadIds: ReadonlySet<string> },
): string | null {
  return (
    db
      .select({ threadId: threadPurges.threadId })
      .from(threadPurges)
      .where(
        and(
          args.excludedThreadIds.size === 0
            ? undefined
            : notInArray(threadPurges.threadId, [...args.excludedThreadIds]),
          notExists(
            db
              .select({ id: threads.id })
              .from(threads)
              .where(eq(threads.lifecycleOwnerThreadId, threadPurges.threadId)),
          ),
        ),
      )
      .orderBy(asc(threadPurges.requestedAt), asc(threadPurges.threadId))
      .limit(1)
      .get()?.threadId ?? null
  );
}

export function deleteThreadPurgeBatch(
  db: DbQueryConnection,
  args: {
    maxEventBytes: number;
    maxEventRows: number;
    maxRows: number;
    threadId: string;
  },
): number {
  const candidates = db.all<{ bytes: number; id: string }>(sql`
    SELECT id, octet_length(data) AS bytes FROM events
    WHERE thread_id = ${args.threadId}
    ORDER BY sequence
    LIMIT ${args.maxEventRows}
  `);
  const eventIds: string[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (eventIds.length > 0 && bytes + candidate.bytes > args.maxEventBytes)
      break;
    eventIds.push(candidate.id);
    bytes += candidate.bytes;
  }
  if (eventIds.length > 0) {
    return db.delete(events).where(inArray(events.id, eventIds)).run().changes;
  }
  for (const table of THREAD_PURGE_BATCHED_TABLES) {
    const deleted = db.run(sql`
      DELETE FROM ${sql.identifier(table)} WHERE rowid IN (
        SELECT rowid FROM ${sql.identifier(table)}
        WHERE thread_id = ${args.threadId}
        LIMIT ${args.maxRows}
      )
    `).changes;
    if (deleted > 0) return deleted;
  }
  return 0;
}
