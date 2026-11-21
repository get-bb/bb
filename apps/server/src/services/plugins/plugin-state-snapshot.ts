import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { CORE_PLUGIN_DIRECTORIES } from "@bb/domain";
import { z } from "zod";
import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import {
  createPluginStateSnapshot,
  getInstalledPlugin,
  getPluginStateSnapshot,
  listPluginKvRows,
  listPluginSchedules,
  listPluginSettingRows,
  replacePluginSnapshotState,
  setPluginStateSnapshotStatus,
  type DbConnection,
  type InstalledPluginRow,
  type PluginStateSnapshotRow,
} from "@bb/db";
import { pluginDirectory } from "./plugin-directory.js";

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
const installedPluginRowFields = {
  id: z.string(),
  source: z.string(),
  sourceKind: z.enum(["path", "builtin", "npm", "git"]),
  sourcePath: z.string().nullable(),
  sourceBuiltinName: z.string().nullable(),
  sourceNpmPackage: z.string().nullable(),
  sourceNpmRegistry: z.string().nullable(),
  sourceNpmRequestedSpec: z.string().nullable(),
  sourceNpmSpecKind: z.enum(["default", "exact", "tag", "range"]).nullable(),
  sourceGitUrl: z.string().nullable(),
  sourceGitSubdirectory: z.string().nullable(),
  sourceGitRequestedRef: z.string().nullable(),
  sourceGitRefKind: z.enum(["branch", "tag", "commit"]).nullable(),
  sourceGitRange: z.string().nullable().default(null),
  sourceGitTagPrefix: z.string().nullable().default(null),
  sourceGitResolvedTag: z.string().nullable().default(null),
  npmResolvedVersion: z.string().nullable(),
  npmIntegrity: z.string().nullable(),
  gitResolvedCommit: z.string().nullable(),
  lastUpdateCheckAt: z.number().int().nullable(),
  availableCompatibleVersion: z.string().nullable(),
  newestIncompatibleVersion: z.string().nullable(),
  updateStatusDetail: z.string().nullable(),
  lastFailureVersion: z.string().nullable(),
  lastFailureAt: z.number().int().nullable(),
  lastFailureDetail: z.string().nullable(),
  lastFailureLabel: z.string().nullable().default(null),
  activeArtifactId: z.string().nullable(),
  normalizationVersion: z.number().int(),
  rootDir: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  enabledFollowsDefault: z.boolean().default(false),
  removedAt: z.number().int().nullable(),
  installedAt: z.number().int(),
  updatedAt: z.number().int(),
} as const;
const installedPluginRowSchema = z
  .object({
    ...installedPluginRowFields,
    provenance: z.enum(["builtin", "direct", "catalog"]),
    catalogEntryId: z.string().nullable(),
    catalogMarketplaceName: z.string().nullable().default(null),
  })
  .strict();
const legacyInstalledPluginRowSchema = z
  .object({
    ...installedPluginRowFields,
    provenance: z.enum(["builtin", "direct", "marketplace"]),
    marketplaceId: z.string().nullable(),
    marketplaceEntryId: z.string().nullable(),
  })
  .strict();

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

const execFileAsync = promisify(execFile);

async function cloneTree(source: string, destination: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("/bin/cp", ["-cRp", source, destination]);
    return;
  }
  await cp(source, destination, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
}

function snapshotFilesPath(snapshotPath: string): string {
  return join(snapshotPath, "files");
}

export async function createPluginStateSnapshotOnDisk(args: {
  db: DbConnection;
  dataDir: string;
  pluginId: string;
  fromArtifactId: string | null;
  toArtifactId: string;
  now: number;
  retainedUntil: number;
  previousRegistration: InstalledPluginRow;
}): Promise<PluginStateSnapshotRow> {
  const id = randomUUID();
  const snapshotPath = join(
    args.dataDir,
    "plugins",
    CORE_PLUGIN_DIRECTORIES.stateSnapshots,
    args.pluginId,
    `${args.now}-${args.toArtifactId}-${id}`,
  );
  const sourceDatabasePath = pluginDirectory(
    args.dataDir,
    args.pluginId,
    "data.db",
  );
  const databasePath = join(snapshotPath, "data.db");
  const statePath = join(snapshotPath, "host-state.json");
  const registrationPath = join(snapshotPath, "previous-registration.json");
  const sourceSecretsPath = pluginDirectory(
    args.dataDir,
    args.pluginId,
    "secrets",
  );
  const secretsPath = join(snapshotPath, "secrets");
  const sourceFilesPath = pluginDirectory(args.dataDir, args.pluginId, "files");
  const hasDatabase = await exists(sourceDatabasePath);
  const hasSecrets = await exists(sourceSecretsPath);
  const hasFiles = await exists(sourceFilesPath);
  const record = createPluginStateSnapshot(args.db, {
    id,
    pluginId: args.pluginId,
    fromArtifactId: args.fromArtifactId,
    toArtifactId: args.toArtifactId,
    snapshotPath,
    databasePath: hasDatabase ? databasePath : null,
    statePath,
    secretsPath: hasSecrets ? secretsPath : null,
    registrationPath,
    status: "pending",
    rollbackCandidateVersion: null,
    rollbackCandidateLabel: null,
    rollbackSourceFingerprint: null,
    rollbackBbVersion: null,
    rollbackSdkVersion: null,
    rollbackDetail: null,
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
      await cloneTree(sourceSecretsPath, secretsPath);
    }
    if (hasFiles) {
      await cloneTree(sourceFilesPath, snapshotFilesPath(snapshotPath));
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
    await writeFile(
      registrationPath,
      JSON.stringify(args.previousRegistration),
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
    snapshot.status !== "rollback-pending" &&
    snapshot.status !== "restoring" &&
    snapshot.status !== "restored"
  ) {
    throw new Error(
      `plugin state snapshot ${snapshot.id} is not restorable (${snapshot.status})`,
    );
  }
  setPluginStateSnapshotStatus(args.db, snapshot.id, "restoring", args.now);
  const targetDatabasePath = pluginDirectory(
    args.dataDir,
    snapshot.pluginId,
    "data.db",
  );
  await mkdir(dirname(targetDatabasePath), { recursive: true });
  await rm(`${targetDatabasePath}-wal`, { force: true });
  await rm(`${targetDatabasePath}-shm`, { force: true });
  if (snapshot.databasePath === null) {
    await rm(targetDatabasePath, { force: true });
  } else {
    await copyFile(snapshot.databasePath, targetDatabasePath);
  }
  const targetSecretsPath = pluginDirectory(
    args.dataDir,
    snapshot.pluginId,
    "secrets",
  );
  await rm(targetSecretsPath, { recursive: true, force: true });
  if (snapshot.secretsPath !== null) {
    await cloneTree(snapshot.secretsPath, targetSecretsPath);
  }
  const targetFilesPath = pluginDirectory(
    args.dataDir,
    snapshot.pluginId,
    "files",
  );
  await rm(targetFilesPath, { recursive: true, force: true });
  const filesPath = snapshotFilesPath(snapshot.snapshotPath);
  if (await exists(filesPath)) {
    await cloneTree(filesPath, targetFilesPath);
  }
  await restorePluginHostStateSnapshot({
    db: args.db,
    snapshotId: snapshot.id,
  });
}

export async function readPluginSnapshotRegistration(args: {
  db: DbConnection;
  snapshotId: string;
}): Promise<InstalledPluginRow> {
  const snapshot = getPluginStateSnapshot(args.db, args.snapshotId);
  if (snapshot === undefined) {
    throw new Error(`plugin state snapshot disappeared: ${args.snapshotId}`);
  }
  if (snapshot.registrationPath === null) {
    throw new Error(
      `plugin state snapshot ${snapshot.id} predates restart-safe rollback metadata`,
    );
  }
  const json: unknown = JSON.parse(
    await readFile(snapshot.registrationPath, "utf8"),
  );
  const current = installedPluginRowSchema.safeParse(json);
  if (current.success) return current.data;
  const legacy = legacyInstalledPluginRowSchema.parse(json);
  const { marketplaceId, marketplaceEntryId, ...registration } = legacy;
  const installed = getInstalledPlugin(args.db, legacy.id);
  if (
    legacy.provenance === "marketplace" &&
    marketplaceId === CURATED_PLUGIN_MARKETPLACE_NAME &&
    marketplaceEntryId !== null &&
    installed?.provenance === "catalog" &&
    installed.catalogEntryId === marketplaceEntryId
  ) {
    return {
      ...registration,
      provenance: "catalog",
      catalogEntryId: marketplaceEntryId,
      catalogMarketplaceName: CURATED_PLUGIN_MARKETPLACE_NAME,
    };
  }
  return {
    ...registration,
    provenance: legacy.provenance === "builtin" ? "builtin" : "direct",
    catalogEntryId: null,
    catalogMarketplaceName: null,
  };
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
