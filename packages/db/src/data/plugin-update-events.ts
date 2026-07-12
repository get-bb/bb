import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { pluginUpdateEvents } from "../schema.js";

export type PluginUpdateEventKind =
  | "check"
  | "resolve"
  | "download"
  | "activate"
  | "rollback"
  | "auto-apply-skipped";

export interface PluginUpdateEventRow {
  id: string;
  pluginId: string;
  kind: PluginUpdateEventKind;
  fromVersion: string | null;
  toVersion: string | null;
  outcome: string;
  detail: string | null;
  createdAt: number;
  retainedUntil: number;
}

export function createPluginUpdateEvent(
  db: DbConnection,
  event: PluginUpdateEventRow,
): void {
  db.insert(pluginUpdateEvents).values(event).run();
}

export function listPluginUpdateEvents(
  db: DbConnection,
  args: { pluginId?: string; limit: number },
): PluginUpdateEventRow[] {
  const query = db.select().from(pluginUpdateEvents);
  return (args.pluginId === undefined
    ? query
    : query.where(eq(pluginUpdateEvents.pluginId, args.pluginId)))
    .orderBy(desc(pluginUpdateEvents.createdAt), desc(pluginUpdateEvents.id))
    .limit(args.limit)
    .all();
}

export function pruneExpiredPluginUpdateEvents(
  db: DbConnection,
  args: { now: number; limit: number },
): number {
  const expired = db
    .select({ id: pluginUpdateEvents.id })
    .from(pluginUpdateEvents)
    .where(lte(pluginUpdateEvents.retainedUntil, args.now))
    .orderBy(asc(pluginUpdateEvents.retainedUntil))
    .limit(args.limit)
    .all();
  if (expired.length === 0) return 0;
  return db.transaction((tx) => {
    let deleted = 0;
    for (const event of expired) {
      deleted += tx
        .delete(pluginUpdateEvents)
        .where(
          and(
            eq(pluginUpdateEvents.id, event.id),
            lte(pluginUpdateEvents.retainedUntil, args.now),
          ),
        )
        .run().changes;
    }
    return deleted;
  });
}
