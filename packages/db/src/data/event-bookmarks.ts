import { sql } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";

export function preserveEventBookmark(
  db: DbQueryConnection,
  args: { threadId: string; sequence: number; providerThreadId: string | null },
): void {
  db.run(sql`INSERT INTO thread_event_bookmarks
    (thread_id, sequence, provider_sequence, provider_thread_id)
    VALUES (${args.threadId}, ${args.sequence}, ${args.providerThreadId === null ? 0 : args.sequence}, ${args.providerThreadId})
    ON CONFLICT(thread_id) DO UPDATE SET
      sequence = MAX(sequence, excluded.sequence),
      provider_thread_id = CASE WHEN excluded.provider_sequence > provider_sequence THEN excluded.provider_thread_id ELSE provider_thread_id END,
      provider_sequence = MAX(provider_sequence, excluded.provider_sequence)`);
}
