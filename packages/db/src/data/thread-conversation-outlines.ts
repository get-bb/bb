import { and, eq, gt } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { threadConversationOutlines } from "../schema.js";

export interface ThreadConversationOutlineResponseRecord {
  responseKey: string;
  responseTailJson: string;
}

export interface ThreadConversationOutlineCheckpointRecord {
  itemsJson: string;
  projectionKey: string;
  response: ThreadConversationOutlineResponseRecord | null;
  sequenceStart: number;
  stateJson: string;
}

export function getThreadConversationOutlineKeys(
  db: DbConnection,
  threadId: string,
): { projectionKey: string; responseKey: string | null } | null {
  return (
    db
      .select({
        projectionKey: threadConversationOutlines.projectionKey,
        responseKey: threadConversationOutlines.responseKey,
      })
      .from(threadConversationOutlines)
      .where(eq(threadConversationOutlines.threadId, threadId))
      .get() ?? null
  );
}

export function getThreadConversationOutlineCheckpoint(
  db: DbConnection,
  threadId: string,
): ThreadConversationOutlineCheckpointRecord | null {
  const row = db
    .select({
      itemsJson: threadConversationOutlines.itemsJson,
      projectionKey: threadConversationOutlines.projectionKey,
      responseKey: threadConversationOutlines.responseKey,
      responseTailJson: threadConversationOutlines.responseTailJson,
      sequenceStart: threadConversationOutlines.sequenceStart,
      stateJson: threadConversationOutlines.stateJson,
    })
    .from(threadConversationOutlines)
    .where(eq(threadConversationOutlines.threadId, threadId))
    .get();
  if (row === undefined) return null;
  return {
    itemsJson: row.itemsJson,
    projectionKey: row.projectionKey,
    response:
      row.responseKey === null || row.responseTailJson === null
        ? null
        : {
            responseKey: row.responseKey,
            responseTailJson: row.responseTailJson,
          },
    sequenceStart: row.sequenceStart,
    stateJson: row.stateJson,
  };
}

export function upsertThreadConversationOutlineCheckpoint(
  db: DbConnection,
  args: ThreadConversationOutlineCheckpointRecord & { threadId: string },
): void {
  const values = {
    itemsJson: args.itemsJson,
    projectionKey: args.projectionKey,
    responseKey: args.response?.responseKey ?? null,
    responseTailJson: args.response?.responseTailJson ?? null,
    sequenceStart: args.sequenceStart,
    stateJson: args.stateJson,
  };
  db.insert(threadConversationOutlines)
    .values({ ...values, threadId: args.threadId })
    .onConflictDoUpdate({
      target: threadConversationOutlines.threadId,
      set: values,
    })
    .run();
}

export function updateThreadConversationOutlineResponse(
  db: DbConnection,
  args: ThreadConversationOutlineResponseRecord & { threadId: string },
): boolean {
  return (
    db
      .update(threadConversationOutlines)
      .set({
        responseKey: args.responseKey,
        responseTailJson: args.responseTailJson,
      })
      .where(eq(threadConversationOutlines.threadId, args.threadId))
      .run().changes > 0
  );
}

export function deleteThreadConversationOutlineCheckpoint(
  db: DbConnection,
  threadId: string,
): void {
  db.delete(threadConversationOutlines)
    .where(eq(threadConversationOutlines.threadId, threadId))
    .run();
}

export function invalidateThreadConversationOutlineFrom(
  db: DbQueryConnection,
  args: { threadId: string; sequence: number },
): void {
  db.delete(threadConversationOutlines)
    .where(
      and(
        eq(threadConversationOutlines.threadId, args.threadId),
        gt(threadConversationOutlines.sequenceStart, args.sequence),
      ),
    )
    .run();
  db.update(threadConversationOutlines)
    .set({ responseKey: null, responseTailJson: null })
    .where(eq(threadConversationOutlines.threadId, args.threadId))
    .run();
}
