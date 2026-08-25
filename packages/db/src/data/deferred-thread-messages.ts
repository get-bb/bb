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

/**
 * The two thread statuses a held message can reach the provider from: a
 * `steer`/`steer-if-active` row resolves to a steer on `active` and to a start
 * on `idle`. `starting`, `stopping` and `error` all refuse the send.
 */
const DELIVERABLE_THREAD_STATUSES: ThreadStatus[] = ["active", "idle"];

/**
 * An environment with a destroy in flight or already gone is never
 * reprovisioned, so nothing addressed to it can ever run again (#1789).
 */
const GONE_ENVIRONMENT_STATUSES: EnvironmentStatus[] = [
  "destroying",
  "destroyed",
];

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

/**
 * Threads whose held messages can be delivered right now: visible, in a status
 * that accepts a send, and attached to a live environment.
 *
 * A thread in `error`, `starting` or `stopping` is deliberately absent. Its
 * rows are not lost — they wait for the status that can take them, which a user
 * retry, a start that lands, or a stop that finishes produces, and the sweep
 * picks the thread up on the tick after that. Listing it here instead would
 * re-run the whole send pipeline and log a delivery failure on every sweep tick
 * for as long as the thread sits there: the pattern #1789 removed from the
 * queued-message sweep (see listIdleThreadsWithQueuedMessages).
 */
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

/**
 * Threads whose held messages can never be delivered: the thread is archived or
 * deleted, or its environment is gone. A held row is only ever created for a
 * thread with a live provider session, so a null `environmentId` here means the
 * environment row was pruned after a destroy, not that the thread never ran.
 *
 * These rows are dropped rather than retried. The set is disjoint from
 * {@link listThreadIdsWithDeliverableDeferredThreadMessages}, so the sweep can
 * walk both without visiting a thread twice.
 */
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
