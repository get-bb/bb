import { and, asc, eq, sql } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { createDeferredThreadMessageId } from "../ids.js";
import { deferredThreadMessages } from "../schema.js";

export type DeferredThreadMessageRow =
  typeof deferredThreadMessages.$inferSelect;

export interface CreateDeferredThreadMessageInput {
  threadId: string;
  kind: string;
  /** JSON-encoded message; the server owns the shape behind each `kind`. */
  payload: string;
}

export function createDeferredThreadMessage(
  db: DbConnection,
  input: CreateDeferredThreadMessageInput,
): DeferredThreadMessageRow {
  const row: DeferredThreadMessageRow = {
    id: createDeferredThreadMessageId(),
    threadId: input.threadId,
    kind: input.kind,
    payload: input.payload,
    createdAt: Date.now(),
  };
  db.insert(deferredThreadMessages).values(row).run();
  return row;
}

/**
 * Oldest first: deferred messages deliver in arrival order. Rows created in
 * the same millisecond have random ids, so the insertion rowid breaks ties.
 */
export function listDeferredThreadMessages(
  db: DbQueryConnection,
  threadId: string,
): DeferredThreadMessageRow[] {
  return db
    .select()
    .from(deferredThreadMessages)
    .where(eq(deferredThreadMessages.threadId, threadId))
    .orderBy(
      asc(deferredThreadMessages.createdAt),
      asc(sql`${deferredThreadMessages}.rowid`),
    )
    .all();
}

export function listThreadIdsWithDeferredThreadMessages(
  db: DbQueryConnection,
): string[] {
  return db
    .selectDistinct({ threadId: deferredThreadMessages.threadId })
    .from(deferredThreadMessages)
    .all()
    .map((row) => row.threadId);
}

/** Returns true when the row still existed, so a caller can claim it. */
export function deleteDeferredThreadMessage(
  db: DbQueryConnection,
  args: { id: string; threadId: string },
): boolean {
  return (
    db
      .delete(deferredThreadMessages)
      .where(
        and(
          eq(deferredThreadMessages.id, args.id),
          eq(deferredThreadMessages.threadId, args.threadId),
        ),
      )
      .run().changes > 0
  );
}

export function deleteDeferredThreadMessagesForThread(
  db: DbConnection,
  threadId: string,
): number {
  return db
    .delete(deferredThreadMessages)
    .where(eq(deferredThreadMessages.threadId, threadId))
    .run().changes;
}
