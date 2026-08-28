import { and, asc, eq, lte } from "drizzle-orm";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { threadRetentionSchedules } from "../schema.js";

type ThreadRetentionWriteConnection = DbConnection | DbTransaction;

export type ThreadRetentionSchedule =
  typeof threadRetentionSchedules.$inferSelect;

export interface ScheduleArchivedThreadRetentionArgs {
  archivedAt: number;
  conversationDeleteDueAt: number | null;
  threadId: string;
}

export interface ListDueThreadRetentionArgs {
  limit: number;
  now: number;
}

export interface ClearArchivedConversationDeletionArgs {
  archivedAt: number;
  conversationDeleteDueAt: number;
  threadId: string;
}

export function getThreadRetentionSchedule(
  db: DbQueryConnection,
  threadId: string,
): ThreadRetentionSchedule | null {
  return (
    db
      .select()
      .from(threadRetentionSchedules)
      .where(eq(threadRetentionSchedules.threadId, threadId))
      .get() ?? null
  );
}

export function scheduleArchivedThreadRetention(
  db: ThreadRetentionWriteConnection,
  args: ScheduleArchivedThreadRetentionArgs,
): ThreadRetentionSchedule | null {
  if (args.conversationDeleteDueAt === null) {
    return null;
  }

  const now = Date.now();
  db.insert(threadRetentionSchedules)
    .values({
      archivedAt: args.archivedAt,
      conversationDeleteDueAt: args.conversationDeleteDueAt,
      createdAt: now,
      threadId: args.threadId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: threadRetentionSchedules.threadId,
      set: {
        archivedAt: args.archivedAt,
        conversationDeleteDueAt: args.conversationDeleteDueAt,
        updatedAt: now,
      },
    })
    .run();
  return getThreadRetentionSchedule(db, args.threadId);
}

export function cancelThreadRetention(
  db: ThreadRetentionWriteConnection,
  threadId: string,
): boolean {
  return (
    db
      .delete(threadRetentionSchedules)
      .where(eq(threadRetentionSchedules.threadId, threadId))
      .run().changes > 0
  );
}

export function listDueArchivedConversationDeletions(
  db: DbQueryConnection,
  args: ListDueThreadRetentionArgs,
): ThreadRetentionSchedule[] {
  return db
    .select()
    .from(threadRetentionSchedules)
    .where(lte(threadRetentionSchedules.conversationDeleteDueAt, args.now))
    .orderBy(
      asc(threadRetentionSchedules.conversationDeleteDueAt),
      asc(threadRetentionSchedules.threadId),
    )
    .limit(args.limit)
    .all();
}

export function clearArchivedConversationDeletion(
  db: ThreadRetentionWriteConnection,
  args: ClearArchivedConversationDeletionArgs,
): boolean {
  return (
    db
      .delete(threadRetentionSchedules)
      .where(
        and(
          eq(threadRetentionSchedules.threadId, args.threadId),
          eq(threadRetentionSchedules.archivedAt, args.archivedAt),
          eq(
            threadRetentionSchedules.conversationDeleteDueAt,
            args.conversationDeleteDueAt,
          ),
        ),
      )
      .run().changes > 0
  );
}
