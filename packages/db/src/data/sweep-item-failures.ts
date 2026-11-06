import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { sweepItemFailures } from "../schema.js";

export type SweepItemFailure = typeof sweepItemFailures.$inferSelect;

export function listSweepItemFailures(
  db: DbQueryConnection,
  sweep: string,
): SweepItemFailure[] {
  return db
    .select()
    .from(sweepItemFailures)
    .where(eq(sweepItemFailures.sweep, sweep))
    .all();
}

export function getSweepItemFailure(
  db: DbQueryConnection,
  args: { itemKey: string; sweep: string },
): SweepItemFailure | null {
  return (
    db
      .select()
      .from(sweepItemFailures)
      .where(
        and(
          eq(sweepItemFailures.sweep, args.sweep),
          eq(sweepItemFailures.itemKey, args.itemKey),
        ),
      )
      .get() ?? null
  );
}

export function upsertSweepItemFailure(
  db: DbQueryConnection,
  failure: SweepItemFailure,
): void {
  db.insert(sweepItemFailures)
    .values(failure)
    .onConflictDoUpdate({
      target: [sweepItemFailures.sweep, sweepItemFailures.itemKey],
      set: {
        attempts: failure.attempts,
        lastError: failure.lastError,
        retryAt: failure.retryAt,
      },
    })
    .run();
}

export function deleteSweepItemFailures(
  db: DbQueryConnection,
  args: { itemKeys: readonly string[]; sweep: string },
): void {
  if (args.itemKeys.length === 0) return;
  db.delete(sweepItemFailures)
    .where(
      and(
        eq(sweepItemFailures.sweep, args.sweep),
        inArray(sweepItemFailures.itemKey, [...args.itemKeys]),
      ),
    )
    .run();
}

export function deleteSweepItemFailuresOfUnknownSweeps(
  db: DbQueryConnection,
  knownSweeps: readonly string[],
): number {
  return db
    .delete(sweepItemFailures)
    .where(notInArray(sweepItemFailures.sweep, [...knownSweeps]))
    .run().changes;
}
