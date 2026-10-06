import { asc, eq, gt, lte, sql } from "drizzle-orm";
import type { EnvironmentRemoval, EnvironmentRemovalPage } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { environmentRemovals, environmentRemovalFeedState } from "../schema.js";

const RETENTION_MS = 30 * 86400000;
type RemovalRow = typeof environmentRemovals.$inferSelect;
function toRemoval({ sequence, ...row }: RemovalRow): EnvironmentRemoval {
  return { ...row, id: String(sequence) };
}

export function recordEnvironmentRemoval(
  db: DbConnection,
  removal: Omit<EnvironmentRemoval, "id">,
): EnvironmentRemoval {
  return db.transaction(() => {
    pruneEnvironmentRemovals(db, removal.removedAt);
    return toRemoval(
      db.insert(environmentRemovals).values(removal).returning().get(),
    );
  });
}

export function listEnvironmentRemovals(
  db: DbConnection,
  cursor: number | null,
  limit: number,
  now: number,
): EnvironmentRemovalPage {
  return db.transaction(() => {
    const floor = pruneEnvironmentRemovals(db, now);
    const latest = db
      .select({
        sequence: sql<number>`coalesce(max(${environmentRemovals.sequence}), ${floor})`,
      })
      .from(environmentRemovals)
      .get()!.sequence;
    if (cursor !== null && (cursor < floor || cursor > latest))
      return {
        status: "cursorExpired",
        removals: [],
        nextCursor: String(floor),
        hasMore: false,
      };
    const after = cursor ?? floor;
    const rows = db
      .select()
      .from(environmentRemovals)
      .where(gt(environmentRemovals.sequence, after))
      .orderBy(asc(environmentRemovals.sequence))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    return {
      status: "ok",
      removals: page.map(toRemoval),
      nextCursor: String(page.at(-1)?.sequence ?? after),
      hasMore: rows.length > limit,
    };
  });
}

function pruneEnvironmentRemovals(db: DbConnection, now: number): number {
  db.insert(environmentRemovalFeedState)
    .values({ id: 1, prunedThrough: 0 })
    .onConflictDoNothing()
    .run();
  const expired = db
    .select({
      sequence: sql<number>`coalesce(max(${environmentRemovals.sequence}), 0)`,
    })
    .from(environmentRemovals)
    .where(lte(environmentRemovals.removedAt, now - RETENTION_MS))
    .get()!.sequence;
  const previous = db
    .select()
    .from(environmentRemovalFeedState)
    .where(eq(environmentRemovalFeedState.id, 1))
    .get()!.prunedThrough;
  const floor = Math.max(previous, expired);
  if (floor > previous) {
    db.update(environmentRemovalFeedState)
      .set({ prunedThrough: floor })
      .where(eq(environmentRemovalFeedState.id, 1))
      .run();
    db.delete(environmentRemovals)
      .where(lte(environmentRemovals.sequence, floor))
      .run();
  }
  return floor;
}
