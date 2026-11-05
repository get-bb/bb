import { sql } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
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
