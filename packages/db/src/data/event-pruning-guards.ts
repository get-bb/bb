import { sql } from "drizzle-orm";

export function isBeforeLatestThreadEvent(threadId: string) {
  return sql`events.sequence < (SELECT sequence FROM events WHERE thread_id = ${threadId} ORDER BY sequence DESC LIMIT 1)`;
}
