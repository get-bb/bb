import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  ne,
  notExists,
  notInArray,
  or,
} from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import {
  installedPlugins,
  pluginArtifacts,
  pluginKv,
  pluginSchedules,
  pluginSettings,
  pluginStateSnapshots,
} from "../schema.js";
import type { PluginArtifactRow } from "./plugin-artifacts.js";
import type { PluginKvRow, PluginSettingRow } from "./plugin-storage.js";
import type { PluginScheduleRow } from "./plugin-schedules.js";

export interface PluginStateSnapshotRow {
  id: string;
  pluginId: string;
  fromArtifactId: string | null;
  toArtifactId: string;
  snapshotPath: string;
  databasePath: string | null;
  statePath: string;
  secretsPath: string | null;
  registrationPath: string | null;
  status:
    | "pending"
    | "ready"
    | "rollback-pending"
    | "restoring"
    | "restored"
    | "discarded"
    | "failed";
  operation: "update" | "rollback";
  rollbackCandidateVersion: string | null;
  rollbackSourceFingerprint: string | null;
  rollbackBbVersion: string | null;
  rollbackSdkVersion: string | null;
  rollbackDetail: string | null;
  failureDetail: string | null;
  createdAt: number;
  retainedUntil: number;
  updatedAt: number;
}

export function createPluginStateSnapshot(
  db: DbConnection,
  snapshot: PluginStateSnapshotRow,
): PluginStateSnapshotRow {
  db.insert(pluginStateSnapshots).values(snapshot).run();
  return snapshot;
}

export function getPluginStateSnapshot(
  db: DbConnection,
  id: string,
): PluginStateSnapshotRow | undefined {
  return db
    .select()
    .from(pluginStateSnapshots)
    .where(eq(pluginStateSnapshots.id, id))
    .get();
}

export function listPluginStateSnapshots(
  db: DbConnection,
  pluginId?: string,
): PluginStateSnapshotRow[] {
  const query = db.select().from(pluginStateSnapshots);
  return (pluginId === undefined
    ? query
    : query.where(eq(pluginStateSnapshots.pluginId, pluginId)))
    .orderBy(asc(pluginStateSnapshots.createdAt), asc(pluginStateSnapshots.id))
    .all();
}

const INCOMPLETE_ROLLBACK_STATUSES: PluginStateSnapshotRow["status"][] = [
  "rollback-pending",
  "restoring",
];

export function listIncompletePluginRollbackSnapshots(
  db: DbConnection,
  pluginId?: string,
): PluginStateSnapshotRow[] {
  return db
    .select()
    .from(pluginStateSnapshots)
    .where(
      and(
        inArray(pluginStateSnapshots.status, INCOMPLETE_ROLLBACK_STATUSES),
        pluginId === undefined
          ? undefined
          : eq(pluginStateSnapshots.pluginId, pluginId),
      ),
    )
    .orderBy(asc(pluginStateSnapshots.createdAt), asc(pluginStateSnapshots.id))
    .all();
}

export function findIncompletePluginRollbackSnapshot(
  db: DbConnection,
  pluginId: string,
): PluginStateSnapshotRow | undefined {
  return db
    .select()
    .from(pluginStateSnapshots)
    .where(
      and(
        eq(pluginStateSnapshots.pluginId, pluginId),
        inArray(pluginStateSnapshots.status, INCOMPLETE_ROLLBACK_STATUSES),
      ),
    )
    .orderBy(asc(pluginStateSnapshots.createdAt), asc(pluginStateSnapshots.id))
    .limit(1)
    .get();
}

export function setPluginStateSnapshotFailed(
  db: DbConnection,
  id: string,
  failure: { detail: string; updatedAt: number },
): boolean {
  return (
    db
      .update(pluginStateSnapshots)
      .set({
        status: "failed",
        failureDetail: failure.detail,
        updatedAt: failure.updatedAt,
      })
      .where(
        and(
          eq(pluginStateSnapshots.id, id),
          inArray(pluginStateSnapshots.status, ["pending", "rollback-pending"]),
        ),
      )
      .run().changes > 0
  );
}

export function setPluginStateSnapshotRestoring(
  db: DbConnection,
  id: string,
  updatedAt: number,
): boolean {
  return (
    db
      .update(pluginStateSnapshots)
      .set({ status: "restoring", updatedAt })
      .where(
        and(
          eq(pluginStateSnapshots.id, id),
          inArray(pluginStateSnapshots.status, INCOMPLETE_ROLLBACK_STATUSES),
        ),
      )
      .run().changes > 0
  );
}

export function setPluginStateSnapshotRestoreFailure(
  db: DbConnection,
  id: string,
  failure: { detail: string; updatedAt: number },
): boolean {
  return (
    db
      .update(pluginStateSnapshots)
      .set({ failureDetail: failure.detail, updatedAt: failure.updatedAt })
      .where(
        and(
          eq(pluginStateSnapshots.id, id),
          inArray(pluginStateSnapshots.status, INCOMPLETE_ROLLBACK_STATUSES),
        ),
      )
      .run().changes > 0
  );
}

export function completePluginStateSnapshotRestore(
  db: DbConnection,
  snapshot: { id: string; pluginId: string; updatedAt: number },
): PluginStateSnapshotRow[] | undefined {
  return db.transaction((tx) => {
    const superseded = tx
      .select()
      .from(pluginStateSnapshots)
      .where(
        and(
          eq(pluginStateSnapshots.pluginId, snapshot.pluginId),
          ne(pluginStateSnapshots.id, snapshot.id),
          inArray(pluginStateSnapshots.status, INCOMPLETE_ROLLBACK_STATUSES),
        ),
      )
      .all();
    const restored = tx
      .update(pluginStateSnapshots)
      .set({ status: "restored", updatedAt: snapshot.updatedAt })
      .where(eq(pluginStateSnapshots.id, snapshot.id))
      .run().changes;
    if (restored === 0) return undefined;
    if (superseded.length > 0) {
      tx.update(pluginStateSnapshots)
        .set({ status: "discarded", updatedAt: snapshot.updatedAt })
        .where(
          inArray(
            pluginStateSnapshots.id,
            superseded.map(({ id }) => id),
          ),
        )
        .run();
    }
    return superseded.map((row) => ({ ...row, status: "discarded" as const }));
  });
}

export interface PluginStateSnapshotRollbackMetadata {
  candidateVersion: string;
  sourceFingerprint: string;
  bbVersion: string;
  sdkVersion: string;
  detail: string;
  updatedAt: number;
}

function rollbackMetadataColumns(rollback: PluginStateSnapshotRollbackMetadata) {
  return {
    rollbackCandidateVersion: rollback.candidateVersion,
    rollbackSourceFingerprint: rollback.sourceFingerprint,
    rollbackBbVersion: rollback.bbVersion,
    rollbackSdkVersion: rollback.sdkVersion,
    rollbackDetail: rollback.detail,
    updatedAt: rollback.updatedAt,
  };
}

export function setPluginStateSnapshotRollbackPending(
  db: DbConnection,
  id: string,
  rollback: PluginStateSnapshotRollbackMetadata,
): boolean {
  return (
    db
      .update(pluginStateSnapshots)
      .set({ status: "rollback-pending", ...rollbackMetadataColumns(rollback) })
      .where(
        and(
          eq(pluginStateSnapshots.id, id),
          inArray(pluginStateSnapshots.status, ["ready", "rollback-pending"]),
        ),
      )
      .run().changes > 0
  );
}

export function setPluginStateSnapshotRollbackWriting(
  db: DbConnection,
  id: string,
  rollback: PluginStateSnapshotRollbackMetadata,
): boolean {
  return (
    db
      .update(pluginStateSnapshots)
      .set({ status: "restoring", ...rollbackMetadataColumns(rollback) })
      .where(
        and(
          eq(pluginStateSnapshots.id, id),
          eq(pluginStateSnapshots.status, "ready"),
          eq(pluginStateSnapshots.operation, "rollback"),
        ),
      )
      .run().changes > 0
  );
}

export function setPluginStateSnapshotRollbackApplied(
  db: DbConnection,
  id: string,
  updatedAt: number,
): boolean {
  return (
    db
      .update(pluginStateSnapshots)
      .set({ status: "rollback-pending", updatedAt })
      .where(
        and(
          eq(pluginStateSnapshots.id, id),
          eq(pluginStateSnapshots.status, "restoring"),
          eq(pluginStateSnapshots.operation, "rollback"),
        ),
      )
      .run().changes > 0
  );
}

export function setPluginStateSnapshotStatus(
  db: DbConnection,
  id: string,
  status: PluginStateSnapshotRow["status"],
  updatedAt: number,
): boolean {
  return (
    db
      .update(pluginStateSnapshots)
      .set({ status, updatedAt })
      .where(eq(pluginStateSnapshots.id, id))
      .run().changes > 0
  );
}

export function listExpiredPluginStateSnapshots(
  db: DbConnection,
  now: number,
): PluginStateSnapshotRow[] {
  return db
    .select()
    .from(pluginStateSnapshots)
    .where(
      and(
        lte(pluginStateSnapshots.retainedUntil, now),
        notInArray(pluginStateSnapshots.status, INCOMPLETE_ROLLBACK_STATUSES),
      ),
    )
    .orderBy(asc(pluginStateSnapshots.retainedUntil))
    .all();
}

export function findPluginRollbackSnapshot(
  db: DbConnection,
  args: { pluginId: string; activeArtifactId: string; now: number },
):
  | { snapshot: PluginStateSnapshotRow; artifact: PluginArtifactRow | null }
  | undefined {
  return db
    .select({ snapshot: pluginStateSnapshots, artifact: pluginArtifacts })
    .from(pluginStateSnapshots)
    .leftJoin(
      pluginArtifacts,
      eq(pluginArtifacts.id, pluginStateSnapshots.fromArtifactId),
    )
    .where(
      and(
        eq(pluginStateSnapshots.pluginId, args.pluginId),
        eq(pluginStateSnapshots.toArtifactId, args.activeArtifactId),
        eq(pluginStateSnapshots.status, "ready"),
        eq(pluginStateSnapshots.operation, "update"),
        gt(pluginStateSnapshots.retainedUntil, args.now),
        isNotNull(pluginStateSnapshots.fromArtifactId),
        isNotNull(pluginStateSnapshots.registrationPath),
      ),
    )
    .orderBy(
      desc(pluginStateSnapshots.createdAt),
      desc(pluginStateSnapshots.id),
    )
    .limit(1)
    .get();
}

export function listRetainedPluginRollbackSnapshots(
  db: DbConnection,
  now: number,
): PluginStateSnapshotRow[] {
  return db
    .select()
    .from(pluginStateSnapshots)
    .where(
      and(
        eq(pluginStateSnapshots.status, "ready"),
        eq(pluginStateSnapshots.operation, "update"),
        gt(pluginStateSnapshots.retainedUntil, now),
        isNotNull(pluginStateSnapshots.fromArtifactId),
        isNotNull(pluginStateSnapshots.registrationPath),
      ),
    )
    .orderBy(asc(pluginStateSnapshots.createdAt), asc(pluginStateSnapshots.id))
    .all();
}

export function deletePluginStateSnapshot(
  db: DbConnection,
  id: string,
): boolean {
  return (
    db
      .delete(pluginStateSnapshots)
      .where(eq(pluginStateSnapshots.id, id))
      .run().changes > 0
  );
}

export function replacePluginSnapshotState(
  db: DbConnection,
  pluginId: string,
  state: {
    kv: PluginKvRow[];
    settings: PluginSettingRow[];
    schedules: PluginScheduleRow[];
  },
): void {
  db.transaction((tx) => {
    tx.delete(pluginKv).where(eq(pluginKv.pluginId, pluginId)).run();
    tx.delete(pluginSettings).where(eq(pluginSettings.pluginId, pluginId)).run();
    tx.delete(pluginSchedules)
      .where(eq(pluginSchedules.pluginId, pluginId))
      .run();
    if (state.kv.length > 0) tx.insert(pluginKv).values(state.kv).run();
    if (state.settings.length > 0) {
      tx.insert(pluginSettings).values(state.settings).run();
    }
    if (state.schedules.length > 0) {
      tx.insert(pluginSchedules).values(state.schedules).run();
    }
  });
}

export function listGarbageCollectablePluginArtifacts(
  db: DbConnection,
  args: {
    now: number;
    retentionCutoff: number | null;
    pluginId: string | null;
  },
): Array<typeof pluginArtifacts.$inferSelect> {
  const activeArtifact = db
    .select({ id: installedPlugins.id })
    .from(installedPlugins)
    .where(eq(installedPlugins.activeArtifactId, pluginArtifacts.id));
  const referencesArtifact = or(
    eq(pluginStateSnapshots.fromArtifactId, pluginArtifacts.id),
    eq(pluginStateSnapshots.toArtifactId, pluginArtifacts.id),
  );
  const retainingSnapshot = db
    .select({ id: pluginStateSnapshots.id })
    .from(pluginStateSnapshots)
    .where(
      or(
        and(
          inArray(pluginStateSnapshots.status, INCOMPLETE_ROLLBACK_STATUSES),
          referencesArtifact,
        ),
        and(
          eq(pluginStateSnapshots.status, "ready"),
          eq(pluginStateSnapshots.operation, "update"),
          gt(pluginStateSnapshots.retainedUntil, args.now),
          eq(pluginStateSnapshots.fromArtifactId, pluginArtifacts.id),
        ),
        args.retentionCutoff === null
          ? undefined
          : and(
              gt(pluginStateSnapshots.retainedUntil, args.now),
              referencesArtifact,
            ),
      ),
    );
  return db
    .select()
    .from(pluginArtifacts)
    .where(
      and(
        args.retentionCutoff === null
          ? undefined
          : lte(pluginArtifacts.updatedAt, args.retentionCutoff),
        args.pluginId === null
          ? undefined
          : eq(pluginArtifacts.pluginId, args.pluginId),
        notExists(activeArtifact),
        notExists(retainingSnapshot),
      ),
    )
    .all();
}
