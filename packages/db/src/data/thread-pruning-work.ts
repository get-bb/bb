import { and, eq, sql } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { threadPruningWork } from "../schema.js";
import type { ThreadPruningPolicy } from "./thread-pruning.js";

export const THREAD_PRUNING_PENDING_POLICY = "pending";

export function markThreadPruningWork(
  db: DbQueryConnection,
  threadIds: Iterable<string>,
): void {
  for (const threadId of new Set(threadIds)) {
    db.run(sql`INSERT OR IGNORE INTO thread_pruning_work (policy, thread_id)
      VALUES (${THREAD_PRUNING_PENDING_POLICY}, ${threadId})`);
  }
}

export function markThreadPruningPolicyWork(
  db: DbQueryConnection,
  threadIds: Iterable<string>,
  policy: ThreadPruningPolicy,
): void {
  for (const threadId of new Set(threadIds)) {
    db.run(sql`INSERT INTO thread_pruning_work (policy, thread_id)
      VALUES (${policy}, ${threadId})
      ON CONFLICT (policy, thread_id) DO UPDATE SET revision = revision + 1`);
  }
}

export function drainPendingThreadPruningWork(
  db: DbQueryConnection,
  threadId?: string,
): void {
  const pending = db
    .select({ threadId: threadPruningWork.threadId })
    .from(threadPruningWork)
    .where(
      and(
        eq(threadPruningWork.policy, THREAD_PRUNING_PENDING_POLICY),
        threadId === undefined
          ? undefined
          : eq(threadPruningWork.threadId, threadId),
      ),
    )
    .orderBy(threadPruningWork.threadId)
    .limit(32)
    .all();
  for (const { threadId } of pending) {
    db.run(sql`INSERT INTO thread_pruning_work (policy, thread_id)
      VALUES ('rate-limits', ${threadId}), ('usage', ${threadId}),
        ('turn-diffs', ${threadId}), ('resolved-items', ${threadId})
      ON CONFLICT (policy, thread_id) DO UPDATE SET revision = revision + 1`);
    db.run(sql`DELETE FROM thread_pruning_work
      WHERE policy = ${THREAD_PRUNING_PENDING_POLICY} AND thread_id = ${threadId}`);
  }
}
