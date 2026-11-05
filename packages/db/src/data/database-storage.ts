import { count, eq, gt, max, sql } from "drizzle-orm";
import {
  prepareCachedQuery,
  type DbConnection,
  type DbQueryConnection,
} from "../connection.js";
import { events, threads, threadSearchSegments } from "../schema.js";

export type ThreadHistoryState = "active" | "archived" | "deleted";

export interface ThreadHistoryEntry {
  id: string;
  state: ThreadHistoryState;
}

export interface ListThreadHistoryEntriesArgs {
  afterThreadId: string | null;
  limit: number;
}

export interface CountThreadEventsChunkArgs {
  afterSequence: number | null;
  limit: number;
  threadId: string;
}

export interface ThreadEventsChunkCount {
  count: number;
  lastSequence: number | null;
}

interface DatabaseListRow {
  file: string;
  name: string;
}

const prepareThreadHistoryEntries = (db: DbQueryConnection) =>
  db
    .select({
      id: threads.id,
      archivedAt: threads.archivedAt,
      deletedAt: threads.deletedAt,
    })
    .from(threads)
    .where(gt(threads.id, sql.placeholder("afterThreadId")))
    .orderBy(threads.id)
    .limit(sql.placeholder("limit"))
    .prepare();

const prepareThreadEventsChunk = (db: DbQueryConnection) => {
  const chunk = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      sql`${events.threadId} = ${sql.placeholder("threadId")} AND ${events.sequence} > ${sql.placeholder("afterSequence")}`,
    )
    .orderBy(events.sequence)
    .limit(sql.placeholder("limit"))
    .as("chunk");
  return db
    .select({ count: count(), lastSequence: max(chunk.sequence) })
    .from(chunk)
    .prepare();
};

const prepareThreadSearchSegmentsCount = (db: DbQueryConnection) =>
  db
    .select({ count: count() })
    .from(threadSearchSegments)
    .where(eq(threadSearchSegments.threadId, sql.placeholder("threadId")))
    .prepare();

export function readDatabaseFilePath(db: DbConnection): string | null {
  const main = db.$client
    .prepare<[], DatabaseListRow>("PRAGMA database_list")
    .all()
    .find((row) => row.name === "main");
  return main === undefined || main.file === "" ? null : main.file;
}

export function listThreadHistoryEntries(
  db: DbConnection,
  args: ListThreadHistoryEntriesArgs,
): ThreadHistoryEntry[] {
  return prepareCachedQuery(db, prepareThreadHistoryEntries)
    .all({ afterThreadId: args.afterThreadId ?? "", limit: args.limit })
    .map((row) => ({
      id: row.id,
      state:
        row.deletedAt !== null
          ? "deleted"
          : row.archivedAt !== null
            ? "archived"
            : "active",
    }));
}

export function countThreadEventsChunk(
  db: DbConnection,
  args: CountThreadEventsChunkArgs,
): ThreadEventsChunkCount {
  const row = prepareCachedQuery(db, prepareThreadEventsChunk).get({
    afterSequence: args.afterSequence ?? Number.MIN_SAFE_INTEGER,
    limit: args.limit,
    threadId: args.threadId,
  });
  return { count: row?.count ?? 0, lastSequence: row?.lastSequence ?? null };
}

export function countThreadSearchSegments(
  db: DbConnection,
  threadId: string,
): number {
  return (
    prepareCachedQuery(db, prepareThreadSearchSegmentsCount).get({ threadId })
      ?.count ?? 0
  );
}
