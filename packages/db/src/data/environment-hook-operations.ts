import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { environmentHookOperations } from "../schema.js";

export type EnvironmentHookOperationRow =
  typeof environmentHookOperations.$inferSelect;

export interface InsertEnvironmentHookOperationInput {
  id: string;
  hostId: string;
  path: string;
  kind: EnvironmentHookOperationRow["kind"];
  startedAt: number;
}

export interface FinishEnvironmentHookOperationInput {
  finishedAt: number;
  error: string | null;
}

export interface AcknowledgeInterruptedEnvironmentHookOperationInput {
  id: string;
  hostId: string;
  path: string;
  kind: EnvironmentHookOperationRow["kind"];
  finishedAt: number;
  error: string;
}

export function getEnvironmentHookOperation(
  db: DbQueryConnection,
  id: string,
): EnvironmentHookOperationRow | null {
  return (
    db
      .select()
      .from(environmentHookOperations)
      .where(eq(environmentHookOperations.id, id))
      .get() ?? null
  );
}

export function hasEnvironmentHookOperation(
  db: DbQueryConnection,
  id: string,
): boolean {
  return (
    db
      .select({ id: environmentHookOperations.id })
      .from(environmentHookOperations)
      .where(eq(environmentHookOperations.id, id))
      .get() !== undefined
  );
}

export function insertEnvironmentHookOperation(
  db: DbQueryConnection,
  input: InsertEnvironmentHookOperationInput,
): void {
  db.insert(environmentHookOperations)
    .values({
      id: input.id,
      operationId: input.id,
      hostId: input.hostId,
      path: input.path,
      kind: input.kind,
      startedAt: input.startedAt,
    })
    .run();
}

export function restartEnvironmentHookOperation(
  db: DbQueryConnection,
  id: string,
  startedAt: number,
): void {
  db.update(environmentHookOperations)
    .set({ startedAt, finishedAt: null, error: null })
    .where(eq(environmentHookOperations.id, id))
    .run();
}

export function forgetFinishedEnvironmentHookOperations(
  db: DbQueryConnection,
  ids: readonly string[],
): void {
  if (ids.length === 0) return;
  db.delete(environmentHookOperations)
    .where(
      and(
        inArray(environmentHookOperations.id, [...ids]),
        isNotNull(environmentHookOperations.finishedAt),
      ),
    )
    .run();
}

export function finishEnvironmentHookOperation(
  db: DbQueryConnection,
  id: string,
  input: FinishEnvironmentHookOperationInput,
): void {
  db.update(environmentHookOperations)
    .set({ finishedAt: input.finishedAt, error: input.error })
    .where(eq(environmentHookOperations.id, id))
    .run();
}

export function acknowledgeInterruptedEnvironmentHookOperation(
  db: DbQueryConnection,
  input: AcknowledgeInterruptedEnvironmentHookOperationInput,
): void {
  db.insert(environmentHookOperations)
    .values({
      id: input.id,
      operationId: input.id,
      hostId: input.hostId,
      path: input.path,
      kind: input.kind,
      startedAt: input.finishedAt,
      finishedAt: input.finishedAt,
      error: input.error,
    })
    .onConflictDoUpdate({
      target: environmentHookOperations.id,
      set: {
        finishedAt: input.finishedAt,
        error: input.error,
      },
      setWhere: isNull(environmentHookOperations.finishedAt),
    })
    .run();
}

export function listUnfinishedEnvironmentHookOperationIdsOnHost(
  db: DbQueryConnection,
  hostId: string,
): string[] {
  return db
    .select({ id: environmentHookOperations.id })
    .from(environmentHookOperations)
    .where(
      and(
        eq(environmentHookOperations.hostId, hostId),
        isNull(environmentHookOperations.finishedAt),
      ),
    )
    .all()
    .map((row) => row.id);
}
