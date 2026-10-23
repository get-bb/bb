import { and, eq, lt } from "drizzle-orm";
import type { DbQueryConnection, DbTransaction } from "../connection.js";
import { threadInboxReceipts } from "../schema.js";

export type ThreadInboxReceiptRow = typeof threadInboxReceipts.$inferSelect;

export interface ThreadInboxReceiptKey {
  idempotencyKey: string;
  threadId: string;
}

export function getThreadInboxReceipt(
  db: DbQueryConnection,
  args: ThreadInboxReceiptKey,
): ThreadInboxReceiptRow | null {
  return (
    db
      .select()
      .from(threadInboxReceipts)
      .where(
        and(
          eq(threadInboxReceipts.threadId, args.threadId),
          eq(threadInboxReceipts.idempotencyKey, args.idempotencyKey),
        ),
      )
      .get() ?? null
  );
}

export function insertThreadInboxReceiptInTransaction(
  tx: DbTransaction,
  args: ThreadInboxReceiptKey & {
    now: number;
    queuedMessageId: string | null;
  },
): boolean {
  const inserted = tx
    .insert(threadInboxReceipts)
    .values({
      threadId: args.threadId,
      idempotencyKey: args.idempotencyKey,
      queuedMessageId: args.queuedMessageId,
      createdAt: args.now,
    })
    .onConflictDoNothing()
    .returning({ threadId: threadInboxReceipts.threadId })
    .get();
  return inserted !== undefined;
}

export function deleteThreadInboxReceiptsCreatedBefore(
  db: DbQueryConnection,
  cutoff: number,
): number {
  return db
    .delete(threadInboxReceipts)
    .where(lt(threadInboxReceipts.createdAt, cutoff))
    .run().changes;
}
