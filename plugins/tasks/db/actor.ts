import {
  LEGACY_SYSTEM_TASK_ACTOR,
  taskActorSnapshotSchema,
  type TaskActorSnapshot,
} from "../shared/contract.js";

export type { TaskActorSnapshot };
export { LEGACY_SYSTEM_TASK_ACTOR };

/** Nullable SQL triple used for task/comment actor snapshots. */
export interface ActorTripleColumns {
  principalId: string | null;
  principalKind: string | null;
  displayName: string | null;
}

/**
 * Decode a persisted actor triple. An all-null triple is pre-actor legacy data
 * and becomes the stable System (legacy) stamp. A partially-null triple is
 * corruption and throws. A complete triple is validated strictly.
 */
export function decodeTaskActorTriple(
  triple: ActorTripleColumns,
): TaskActorSnapshot {
  const { principalId, principalKind, displayName } = triple;
  const nullCount = [principalId, principalKind, displayName].filter(
    (value) => value === null,
  ).length;
  if (nullCount === 3) return LEGACY_SYSTEM_TASK_ACTOR;
  if (nullCount > 0) {
    throw new Error(
      "Corrupt tasks actor triple: expected all fields null (legacy) or all present",
    );
  }
  return taskActorSnapshotSchema.parse({
    principalId,
    principalKind,
    displayName,
  });
}

/** Validate an actor snapshot before writing it into SQLite. */
export function requireTaskActorSnapshot(value: unknown): TaskActorSnapshot {
  return taskActorSnapshotSchema.parse(value);
}
