import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
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
  hostId: string | null;
  resourceCleanupDueAt: number | null;
  threadId: string;
}

export interface ScheduleImmediateThreadResourceCleanupArgs {
  hostId: string | null;
  now: number;
  threadId: string;
}

export interface ListDueThreadRetentionArgs {
  limit: number;
  now: number;
}

export interface CompleteThreadResourceCleanupArgs {
  archivedAt: number | null;
  resourceCleanupDueAt: number;
  threadId: string;
}

export interface ClearArchivedConversationDeletionArgs {
  archivedAt: number | null;
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
  const resourceCleanupDueAt = args.hostId ? args.resourceCleanupDueAt : null;
  if (resourceCleanupDueAt === null && args.conversationDeleteDueAt === null) {
    return null;
  }

  const now = Date.now();
  db.insert(threadRetentionSchedules)
    .values({
      archivedAt: args.archivedAt,
      conversationDeleteDueAt: args.conversationDeleteDueAt,
      createdAt: now,
      hostId: args.hostId,
      resourceCleanupDueAt,
      threadId: args.threadId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: threadRetentionSchedules.threadId,
      set: {
        archivedAt: args.archivedAt,
        conversationDeleteDueAt: args.conversationDeleteDueAt,
        hostId: args.hostId,
        resourceCleanupDueAt,
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

export function scheduleImmediateThreadResourceCleanup(
  db: ThreadRetentionWriteConnection,
  args: ScheduleImmediateThreadResourceCleanupArgs,
): ThreadRetentionSchedule | null {
  const existing = getThreadRetentionSchedule(db, args.threadId);
  const hostId = existing?.hostId ?? args.hostId;
  if (hostId === null) {
    if (existing) {
      cancelThreadRetention(db, args.threadId);
    }
    return null;
  }

  if (existing) {
    db.update(threadRetentionSchedules)
      .set({
        conversationDeleteDueAt: null,
        hostId,
        resourceCleanupDueAt: args.now,
        updatedAt: args.now,
      })
      .where(eq(threadRetentionSchedules.threadId, args.threadId))
      .run();
  } else {
    db.insert(threadRetentionSchedules)
      .values({
        archivedAt: null,
        conversationDeleteDueAt: null,
        createdAt: args.now,
        hostId,
        resourceCleanupDueAt: args.now,
        threadId: args.threadId,
        updatedAt: args.now,
      })
      .run();
  }
  return getThreadRetentionSchedule(db, args.threadId);
}

export function listDueThreadResourceCleanups(
  db: DbQueryConnection,
  args: ListDueThreadRetentionArgs,
): ThreadRetentionSchedule[] {
  return db
    .select()
    .from(threadRetentionSchedules)
    .where(
      and(
        isNotNull(threadRetentionSchedules.resourceCleanupDueAt),
        lte(threadRetentionSchedules.resourceCleanupDueAt, args.now),
      ),
    )
    .orderBy(
      asc(threadRetentionSchedules.resourceCleanupDueAt),
      asc(threadRetentionSchedules.threadId),
    )
    .limit(args.limit)
    .all();
}

export function listDueArchivedConversationDeletions(
  db: DbQueryConnection,
  args: ListDueThreadRetentionArgs,
): ThreadRetentionSchedule[] {
  return db
    .select()
    .from(threadRetentionSchedules)
    .where(
      and(
        isNotNull(threadRetentionSchedules.conversationDeleteDueAt),
        lte(threadRetentionSchedules.conversationDeleteDueAt, args.now),
      ),
    )
    .orderBy(
      asc(threadRetentionSchedules.conversationDeleteDueAt),
      asc(threadRetentionSchedules.threadId),
    )
    .limit(args.limit)
    .all();
}

export function completeThreadResourceCleanup(
  db: ThreadRetentionWriteConnection,
  args: CompleteThreadResourceCleanupArgs,
): boolean {
  const schedule = getThreadRetentionSchedule(db, args.threadId);
  if (
    !schedule ||
    schedule.archivedAt !== args.archivedAt ||
    schedule.resourceCleanupDueAt !== args.resourceCleanupDueAt
  ) {
    return false;
  }

  const updated: ThreadRetentionSchedule = {
    ...schedule,
    resourceCleanupDueAt: null,
    updatedAt: Date.now(),
  };
  if (updated.conversationDeleteDueAt === null) {
    cancelThreadRetention(db, args.threadId);
  } else {
    db.update(threadRetentionSchedules)
      .set({ resourceCleanupDueAt: null, updatedAt: updated.updatedAt })
      .where(eq(threadRetentionSchedules.threadId, args.threadId))
      .run();
  }
  return true;
}

export function clearArchivedConversationDeletion(
  db: ThreadRetentionWriteConnection,
  args: ClearArchivedConversationDeletionArgs,
): boolean {
  const schedule = getThreadRetentionSchedule(db, args.threadId);
  if (
    !schedule ||
    schedule.archivedAt !== args.archivedAt ||
    schedule.conversationDeleteDueAt !== args.conversationDeleteDueAt
  ) {
    return false;
  }

  const updated: ThreadRetentionSchedule = {
    ...schedule,
    conversationDeleteDueAt: null,
    updatedAt: Date.now(),
  };
  if (updated.resourceCleanupDueAt === null) {
    cancelThreadRetention(db, args.threadId);
  } else {
    db.update(threadRetentionSchedules)
      .set({ conversationDeleteDueAt: null, updatedAt: updated.updatedAt })
      .where(eq(threadRetentionSchedules.threadId, args.threadId))
      .run();
  }
  return true;
}
