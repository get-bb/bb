import { and, asc, eq, gt, lte, notExists, or } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import {
  installedPlugins,
  pluginArtifacts,
  pluginKv,
  pluginSchedules,
  pluginSettings,
  pluginStateSnapshots,
} from "../schema.js";
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
  status: "pending" | "ready" | "restoring" | "restored" | "failed";
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
    .where(lte(pluginStateSnapshots.retainedUntil, now))
    .orderBy(asc(pluginStateSnapshots.retainedUntil))
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
  args: { now: number; cutoff: number },
): Array<typeof pluginArtifacts.$inferSelect> {
  const activeArtifact = db
    .select({ id: installedPlugins.id })
    .from(installedPlugins)
    .where(eq(installedPlugins.activeArtifactId, pluginArtifacts.id));
  const retainingSnapshot = db
    .select({ id: pluginStateSnapshots.id })
    .from(pluginStateSnapshots)
    .where(
      and(
        gt(pluginStateSnapshots.retainedUntil, args.now),
        or(
          eq(pluginStateSnapshots.fromArtifactId, pluginArtifacts.id),
          eq(pluginStateSnapshots.toArtifactId, pluginArtifacts.id),
        ),
      ),
    );
  return db
    .select()
    .from(pluginArtifacts)
    .where(
      and(
        lte(pluginArtifacts.updatedAt, args.cutoff),
        notExists(activeArtifact),
        notExists(retainingSnapshot),
      ),
    )
    .all();
}
