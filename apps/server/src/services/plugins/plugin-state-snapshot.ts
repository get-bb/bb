import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  createPluginStateSnapshot,
  getPluginStateSnapshot,
  listPluginKvRows,
  listPluginSchedules,
  listPluginSettingRows,
  replacePluginSnapshotState,
  setPluginStateSnapshotStatus,
  type DbConnection,
  type PluginStateSnapshotRow,
} from "@bb/db";

const kvRowSchema = z.object({
  pluginId: z.string(),
  key: z.string(),
  value: z.string(),
  updatedAt: z.number().int(),
});
const settingRowSchema = kvRowSchema;
const scheduleRowSchema = z.object({
  pluginId: z.string(),
  name: z.string(),
  cron: z.string(),
  nextRunAt: z.number().int(),
  lastRunAt: z.number().int().nullable(),
  lastStatus: z.enum(["running", "ok", "error"]).nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.number().int(),
});
const stateSchema = z.object({
  kv: z.array(kvRowSchema),
  settings: z.array(settingRowSchema),
  schedules: z.array(scheduleRowSchema),
});

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    (error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    },
  );
}

export function pluginDataDir(dataDir: string, pluginId: string): string {
  return join(dataDir, "plugins", pluginId);
}

export async function createPluginStateSnapshotOnDisk(args: {
  db: DbConnection;
  dataDir: string;
  pluginId: string;
  fromArtifactId: string | null;
  toArtifactId: string;
  now: number;
  retainedUntil: number;
}): Promise<PluginStateSnapshotRow> {
  const id = randomUUID();
  const snapshotPath = join(
    args.dataDir,
    "plugins",
    "snapshots",
    args.pluginId,
    `${args.now}-${args.toArtifactId}-${id}`,
  );
  const sourceDir = pluginDataDir(args.dataDir, args.pluginId);
  const sourceDatabasePath = join(sourceDir, "data.db");
  const databasePath = join(snapshotPath, "data.db");
  const statePath = join(snapshotPath, "host-state.json");
  const sourceSecretsPath = join(sourceDir, "secrets");
  const secretsPath = join(snapshotPath, "secrets");
  const hasDatabase = await exists(sourceDatabasePath);
  const hasSecrets = await exists(sourceSecretsPath);
  const record = createPluginStateSnapshot(args.db, {
    id,
    pluginId: args.pluginId,
    fromArtifactId: args.fromArtifactId,
    toArtifactId: args.toArtifactId,
    snapshotPath,
    databasePath: hasDatabase ? databasePath : null,
    statePath,
    secretsPath: hasSecrets ? secretsPath : null,
    status: "pending",
    createdAt: args.now,
    retainedUntil: args.retainedUntil,
    updatedAt: args.now,
  });
  try {
    await mkdir(snapshotPath, { recursive: true });
    if (hasDatabase) {
      const database = new Database(sourceDatabasePath);
      try {
        database.pragma("wal_checkpoint(TRUNCATE)");
      } finally {
        database.close();
      }
      await copyFile(sourceDatabasePath, databasePath);
    }
    if (hasSecrets) {
      // Secret files are deliberately opaque: names and contents never enter
      // the snapshot record, JSON state, or logs.
      await cp(sourceSecretsPath, secretsPath, { recursive: true });
    }
    await writeFile(
      statePath,
      JSON.stringify({
        kv: listPluginKvRows(args.db, args.pluginId),
        settings: listPluginSettingRows(args.db, args.pluginId),
        schedules: listPluginSchedules(args.db, args.pluginId),
      }),
      { mode: 0o600 },
    );
    setPluginStateSnapshotStatus(args.db, id, "ready", args.now);
    return { ...record, status: "ready" };
  } catch (error) {
    setPluginStateSnapshotStatus(args.db, id, "failed", args.now);
    throw error;
  }
}

export async function restorePluginStateSnapshot(args: {
  db: DbConnection;
  dataDir: string;
  snapshotId: string;
  now: number;
}): Promise<void> {
  const snapshot = getPluginStateSnapshot(args.db, args.snapshotId);
  if (snapshot === undefined) {
    throw new Error(`plugin state snapshot disappeared: ${args.snapshotId}`);
  }
  if (
    snapshot.status !== "ready" &&
    snapshot.status !== "restoring" &&
    snapshot.status !== "restored"
  ) {
    throw new Error(
      `plugin state snapshot ${snapshot.id} is not restorable (${snapshot.status})`,
    );
  }
  setPluginStateSnapshotStatus(args.db, snapshot.id, "restoring", args.now);
  const targetDir = pluginDataDir(args.dataDir, snapshot.pluginId);
  await mkdir(targetDir, { recursive: true });
  const targetDatabasePath = join(targetDir, "data.db");
  await rm(`${targetDatabasePath}-wal`, { force: true });
  await rm(`${targetDatabasePath}-shm`, { force: true });
  if (snapshot.databasePath === null) {
    await rm(targetDatabasePath, { force: true });
  } else {
    await copyFile(snapshot.databasePath, targetDatabasePath);
  }
  const targetSecretsPath = join(targetDir, "secrets");
  await rm(targetSecretsPath, { recursive: true, force: true });
  if (snapshot.secretsPath !== null) {
    await cp(snapshot.secretsPath, targetSecretsPath, { recursive: true });
  }
  await restorePluginHostStateSnapshot({
    db: args.db,
    snapshotId: snapshot.id,
  });
  setPluginStateSnapshotStatus(args.db, snapshot.id, "restored", args.now);
}

export async function restorePluginHostStateSnapshot(args: {
  db: DbConnection;
  snapshotId: string;
}): Promise<void> {
  const snapshot = getPluginStateSnapshot(args.db, args.snapshotId);
  if (snapshot === undefined) {
    throw new Error(`plugin state snapshot disappeared: ${args.snapshotId}`);
  }
  const state = stateSchema.parse(
    JSON.parse(await readFile(snapshot.statePath, "utf8")),
  );
  replacePluginSnapshotState(args.db, snapshot.pluginId, state);
}
