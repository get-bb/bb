import { eq } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { claimedThreadSpawns } from "../schema.js";

export type ClaimedThreadSpawnRow = typeof claimedThreadSpawns.$inferSelect;

export function getClaimedThreadSpawn(
  db: DbQueryConnection,
  claimId: string,
): ClaimedThreadSpawnRow | null {
  return (
    db
      .select()
      .from(claimedThreadSpawns)
      .where(eq(claimedThreadSpawns.claimId, claimId))
      .get() ?? null
  );
}

export function getClaimedThreadSpawnByAttemptId(
  db: DbQueryConnection,
  attemptId: string,
): ClaimedThreadSpawnRow | null {
  return (
    db
      .select()
      .from(claimedThreadSpawns)
      .where(eq(claimedThreadSpawns.attemptId, attemptId))
      .get() ?? null
  );
}

export function getClaimedThreadSpawnByAuthorizationId(
  db: DbQueryConnection,
  authorizationId: string,
): ClaimedThreadSpawnRow | null {
  return (
    db
      .select()
      .from(claimedThreadSpawns)
      .where(eq(claimedThreadSpawns.authorizationId, authorizationId))
      .get() ?? null
  );
}

export function insertClaimedThreadSpawn(
  db: DbQueryConnection,
  row: typeof claimedThreadSpawns.$inferInsert,
): void {
  db.insert(claimedThreadSpawns).values(row).run();
}

export function updateClaimedThreadSpawn(
  db: DbQueryConnection,
  claimId: string,
  change: Partial<typeof claimedThreadSpawns.$inferInsert>,
): void {
  db.update(claimedThreadSpawns)
    .set(change)
    .where(eq(claimedThreadSpawns.claimId, claimId))
    .run();
}
