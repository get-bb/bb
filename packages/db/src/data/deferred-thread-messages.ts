import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { EnvironmentStatus, ThreadStatus } from "@bb/domain";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { createDeferredThreadMessageId } from "../ids.js";
import { deferredThreadMessages, environments, threads } from "../schema.js";

const DELIVERABLE_THREAD_STATUSES: ThreadStatus[] = ["active", "idle"];

const GONE_ENVIRONMENT_STATUSES: EnvironmentStatus[] = [
  "destroying",
  "destroyed",
];

export type DeferredThreadMessageRow =
  typeof deferredThreadMessages.$inferSelect;

export interface CreateDeferredThreadMessageInput {
  threadId: string;
  kind: string;
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

export function listThreadIdsWithDeliverableDeferredThreadMessages(
  db: DbQueryConnection,
): string[] {
  return db
    .selectDistinct({ threadId: deferredThreadMessages.threadId })
    .from(deferredThreadMessages)
    .innerJoin(threads, eq(threads.id, deferredThreadMessages.threadId))
    .innerJoin(environments, eq(environments.id, threads.environmentId))
    .where(
      and(
        inArray(threads.status, DELIVERABLE_THREAD_STATUSES),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        notInArray(environments.status, GONE_ENVIRONMENT_STATUSES),
      ),
    )
    .orderBy(asc(deferredThreadMessages.threadId))
    .all()
    .map((row) => row.threadId);
}

export function listThreadIdsWithUndeliverableDeferredThreadMessages(
  db: DbQueryConnection,
): string[] {
  return db
    .selectDistinct({ threadId: deferredThreadMessages.threadId })
    .from(deferredThreadMessages)
    .innerJoin(threads, eq(threads.id, deferredThreadMessages.threadId))
    .leftJoin(environments, eq(environments.id, threads.environmentId))
    .where(
      or(
        isNotNull(threads.archivedAt),
        isNotNull(threads.deletedAt),
        isNull(threads.environmentId),
        isNull(environments.id),
        inArray(environments.status, GONE_ENVIRONMENT_STATUSES),
      ),
    )
    .orderBy(asc(deferredThreadMessages.threadId))
    .all()
    .map((row) => row.threadId);
}

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
