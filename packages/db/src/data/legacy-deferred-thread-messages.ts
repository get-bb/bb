import { sql } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";

export const LEGACY_DEFERRED_THREAD_MESSAGES_TABLE =
  "deferred_thread_messages_legacy";

export interface LegacyDeferredThreadMessageRow {
  id: string;
  threadId: string;
  payload: string;
}

export function legacyDeferredThreadMessagesTableExists(
  db: DbQueryConnection,
): boolean {
  return (
    db.get<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${LEGACY_DEFERRED_THREAD_MESSAGES_TABLE}`,
    ) !== undefined
  );
}

export function listLegacyDeferredThreadMessages(
  db: DbQueryConnection,
): LegacyDeferredThreadMessageRow[] {
  return db.all<LegacyDeferredThreadMessageRow>(
    sql`SELECT id, thread_id AS threadId, payload FROM deferred_thread_messages_legacy ORDER BY thread_id, created_at, id`,
  );
}

export function deleteLegacyDeferredThreadMessage(
  db: DbQueryConnection,
  id: string,
): void {
  db.run(sql`DELETE FROM deferred_thread_messages_legacy WHERE id = ${id}`);
}

export function dropLegacyDeferredThreadMessagesTable(
  db: DbQueryConnection,
): void {
  db.run(sql`DROP TABLE deferred_thread_messages_legacy`);
}
