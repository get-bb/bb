import { sql } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { rewindRolloutMetrics } from "../schema.js";

/**
 * Increment one aggregate rewind rollout counter. Values are integers only;
 * names are fixed strings owned by the server rewind service, so no prompt
 * content or provider identifiers can reach this table. The counter name is
 * the row's primary key.
 */
export function incrementRewindRolloutMetric(
  db: DbConnection,
  name: string,
): void {
  const updatedAt = Date.now();
  db.insert(rewindRolloutMetrics)
    .values({ id: name, count: 1, updatedAt })
    .onConflictDoUpdate({
      target: rewindRolloutMetrics.id,
      set: {
        count: sql`${rewindRolloutMetrics.count} + 1`,
        updatedAt,
      },
    })
    .run();
}

/** Read all recorded counters as a name -> count map. */
export function listRewindRolloutMetrics(
  db: DbConnection,
): Record<string, number> {
  return Object.fromEntries(
    db
      .select({
        count: rewindRolloutMetrics.count,
        id: rewindRolloutMetrics.id,
      })
      .from(rewindRolloutMetrics)
      .all()
      .map((row) => [row.id, row.count]),
  );
}
