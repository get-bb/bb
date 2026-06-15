import { count, eq } from "drizzle-orm";
import { events, hostDaemonSessions, threads, type DbConnection } from "@bb/db";

export interface StoredTurnEventRow {
  sequence: number;
  turnId: string | null;
  type: string;
}

export function readStoredTurnEvents(
  db: DbConnection,
  threadId: string,
): StoredTurnEventRow[] {
  return db
    .select({
      sequence: events.sequence,
      turnId: events.turnId,
      type: events.type,
    })
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(events.sequence)
    .all();
}

export function readSessionRow(
  db: DbConnection,
  sessionId: string,
): typeof hostDaemonSessions.$inferSelect | null {
  return (
    db
      .select()
      .from(hostDaemonSessions)
      .where(eq(hostDaemonSessions.id, sessionId))
      .get() ?? null
  );
}

export function countStoredThreads(db: DbConnection): number {
  return db.select({ count: count() }).from(threads).get()?.count ?? 0;
}
