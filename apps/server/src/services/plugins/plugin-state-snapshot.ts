import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import {
  createPluginStateSnapshot,
  findIncompletePluginRollbackSnapshot,
  getInstalledPlugin,
  getPluginArtifact,
  getPluginStateSnapshot,
  listPluginKvRows,
  listPluginSchedules,
  listPluginSettingRows,
  replacePluginSnapshotState,
  setPluginStateSnapshotFailed,
  setPluginStateSnapshotStatus,
  type DbConnection,
  type InstalledPluginRow,
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

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    (error: unknown) => {
      if (isMissing(error)) return false;
      throw error;
    },
  );
}

function pluginDataDir(dataDir: string, pluginId: string): string {
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
  previousRegistration: InstalledPluginRow;
  operation: PluginStateSnapshotRow["operation"];
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
  const registrationPath = join(snapshotPath, "previous-registration.json");
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
    registrationPath,
    status: "pending",
    operation: args.operation,
    rollbackCandidateVersion: null,
    rollbackSourceFingerprint: null,
    rollbackBbVersion: null,
    rollbackSdkVersion: null,
    rollbackDetail: null,
    failureDetail: null,
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
    await writeFile(
      registrationPath,
      JSON.stringify(args.previousRegistration),
      { mode: 0o600 },
    );
    setPluginStateSnapshotStatus(args.db, id, "ready", args.now);
    return { ...record, status: "ready" };
  } catch (error) {
    setPluginStateSnapshotFailed(args.db, id, {
      detail: errorMessage(error),
      updatedAt: args.now,
    });
    throw error;
  }
}

export async function restorePluginStateSnapshot(args: {
  db: DbConnection;
  dataDir: string;
  snapshotId: string;
}): Promise<void> {
  const snapshot = getPluginStateSnapshot(args.db, args.snapshotId);
  if (snapshot === undefined) {
    throw new Error(`plugin state snapshot disappeared: ${args.snapshotId}`);
  }
  if (snapshot.status !== "restoring") {
    throw new Error(
      `plugin state snapshot ${snapshot.id} is not being restored (${snapshot.status})`,
    );
  }
  await writePluginStateSnapshotData({
    db: args.db,
    dataDir: args.dataDir,
    snapshot,
  });
}

export async function applyPluginStateSnapshot(args: {
  db: DbConnection;
  dataDir: string;
  snapshotId: string;
}): Promise<void> {
  const snapshot = getPluginStateSnapshot(args.db, args.snapshotId);
  if (snapshot === undefined) {
    throw new Error(`plugin state snapshot disappeared: ${args.snapshotId}`);
  }
  if (snapshot.status !== "ready") {
    throw new Error(
      `plugin state snapshot ${snapshot.id} is no longer a rollback point (${snapshot.status})`,
    );
  }
  await writePluginStateSnapshotData({
    db: args.db,
    dataDir: args.dataDir,
    snapshot,
  });
}

async function writePluginStateSnapshotData(args: {
  db: DbConnection;
  dataDir: string;
  snapshot: PluginStateSnapshotRow;
}): Promise<void> {
  const { snapshot } = args;
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
}

function snapshotRegistration(
  db: DbConnection,
  json: unknown,
):
  | { ok: true; registration: InstalledPluginRow }
  | { ok: false; error: z.ZodError } {
  const current = installedPluginRowSchema.safeParse(json);
  if (current.success) return { ok: true, registration: current.data };
  const legacy = legacyInstalledPluginRowSchema.safeParse(json);
  if (!legacy.success) return { ok: false, error: current.error };
  const { marketplaceId, marketplaceEntryId, ...registration } = legacy.data;
  const installed = getInstalledPlugin(db, legacy.data.id);
  if (
    legacy.data.provenance === "marketplace" &&
    marketplaceId === CURATED_PLUGIN_MARKETPLACE_NAME &&
    marketplaceEntryId !== null &&
    installed?.provenance === "catalog" &&
    installed.catalogEntryId === marketplaceEntryId
  ) {
    return {
      ok: true,
      registration: {
        ...registration,
        provenance: "catalog",
        catalogEntryId: marketplaceEntryId,
        catalogMarketplaceName: CURATED_PLUGIN_MARKETPLACE_NAME,
      },
    };
  }
  return {
    ok: true,
    registration: {
      ...registration,
      provenance: legacy.data.provenance === "builtin" ? "builtin" : "direct",
      catalogEntryId: null,
      catalogMarketplaceName: null,
    },
  };
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
  const parsed = snapshotRegistration(
    args.db,
    JSON.parse(await readFile(snapshot.registrationPath, "utf8")),
  );
  if (!parsed.ok) throw parsed.error;
  return parsed.registration;
}

function firstIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  if (issue === undefined) return error.message;
  const path = issue.path.map(String).join(".");
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}

interface SnapshotProblem {
  kind: "unusable" | "unreadable";
  reason: string;
}

function readProblem(
  error: unknown,
  missing: string,
  unreadable: string,
): SnapshotProblem {
  return isMissing(error)
    ? { kind: "unusable", reason: missing }
    : { kind: "unreadable", reason: `${unreadable}: ${errorMessage(error)}` };
}

async function readSavedJson(
  path: string,
  label: string,
): Promise<
  { ok: true; json: unknown } | { ok: false; problem: SnapshotProblem }
> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return {
      ok: false,
      problem: readProblem(
        error,
        `its saved ${label} is missing`,
        `its saved ${label} could not be read`,
      ),
    };
  }
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      problem: {
        kind: "unusable",
        reason: `its saved ${label} is not valid JSON`,
      },
    };
  }
}

async function assertReadable(path: string): Promise<void> {
  const entry = await lstat(path);
  if (entry.isDirectory()) {
    await access(path, constants.R_OK | constants.X_OK);
    for (const name of await readdir(path)) {
      await assertReadable(join(path, name));
    }
  } else if (entry.isFile()) {
    await access(path, constants.R_OK);
  }
}

async function savedCopyProblem(
  path: string,
  kind: "file" | "directory",
  label: string,
): Promise<SnapshotProblem | null> {
  const unreadable = `its copy of the plugin ${label} could not be read`;
  let entry: Stats;
  try {
    entry = await stat(path);
  } catch (error) {
    return readProblem(
      error,
      `its copy of the plugin ${label} is missing`,
      unreadable,
    );
  }
  if (kind === "file" ? !entry.isFile() : !entry.isDirectory()) {
    return { kind: "unreadable", reason: `${unreadable}: it is not a ${kind}` };
  }
  try {
    await assertReadable(path);
    return null;
  } catch (error) {
    return {
      kind: "unreadable",
      reason: `${unreadable}: ${errorMessage(error)}`,
    };
  }
}

function registrationContentProblem(args: {
  db: DbConnection;
  snapshot: PluginStateSnapshotRow;
  registration: InstalledPluginRow;
  registrationProblem: (registration: InstalledPluginRow) => string | null;
}): string | null {
  const { registration, snapshot } = args;
  if (registration.id !== snapshot.pluginId) {
    return `its saved registration belongs to plugin "${registration.id}"`;
  }
  const problem = args.registrationProblem(registration);
  if (problem !== null) {
    return `its saved registration is inconsistent (${problem})`;
  }
  if (registration.activeArtifactId !== snapshot.fromArtifactId) {
    return "its saved registration names a different release than the one it was saved from";
  }
  if (
    snapshot.fromArtifactId !== null &&
    getPluginArtifact(args.db, snapshot.fromArtifactId) === undefined
  ) {
    return `the release it restores is no longer kept (artifact ${snapshot.fromArtifactId})`;
  }
  return null;
}

export async function checkPluginStateSnapshot(args: {
  db: DbConnection;
  snapshot: PluginStateSnapshotRow;
  registrationProblem: (registration: InstalledPluginRow) => string | null;
}): Promise<
  { kind: "usable"; registration: InstalledPluginRow } | SnapshotProblem
> {
  const { snapshot } = args;
  if (snapshot.registrationPath === null) {
    return {
      kind: "unusable",
      reason: "it predates restart-safe rollback metadata",
    };
  }
  const registrationJson = await readSavedJson(
    snapshot.registrationPath,
    "registration",
  );
  if (!registrationJson.ok) return registrationJson.problem;
  const parsed = snapshotRegistration(args.db, registrationJson.json);
  if (!parsed.ok) {
    return {
      kind: "unusable",
      reason: `its saved registration does not match this bb's format (${firstIssue(parsed.error)})`,
    };
  }
  const registrationProblem = registrationContentProblem({
    db: args.db,
    snapshot,
    registration: parsed.registration,
    registrationProblem: args.registrationProblem,
  });
  if (registrationProblem !== null) {
    return { kind: "unusable", reason: registrationProblem };
  }
  const stateJson = await readSavedJson(snapshot.statePath, "host state");
  if (!stateJson.ok) return stateJson.problem;
  const state = stateSchema.safeParse(stateJson.json);
  if (!state.success) {
    return {
      kind: "unusable",
      reason: `its saved host state does not match this bb's format (${firstIssue(state.error)})`,
    };
  }
  const copyProblem =
    (snapshot.databasePath === null
      ? null
      : await savedCopyProblem(snapshot.databasePath, "file", "database")) ??
    (snapshot.secretsPath === null
      ? null
      : await savedCopyProblem(snapshot.secretsPath, "directory", "secrets"));
  if (copyProblem !== null) return copyProblem;
  return { kind: "usable", registration: parsed.registration };
}

export function pluginRestoreHold(
  db: DbConnection,
  pluginId: string,
): string | null {
  const snapshot = findIncompletePluginRollbackSnapshot(db, pluginId);
  if (snapshot === undefined) return null;
  const reason =
    snapshot.failureDetail === null ? "" : `: ${snapshot.failureDetail}`;
  return `held until bb finishes undoing its ${snapshot.operation}${reason}; run \`bb plugin reload ${pluginId}\` to retry, or remove the plugin as a last resort`;
}

export function pluginRestoreHoldRefusal(
  db: DbConnection,
  pluginId: string,
  action: string,
): string | null {
  const hold = pluginRestoreHold(db, pluginId);
  return hold === null
    ? null
    : `${action} refused: plugin "${pluginId}" is ${hold}`;
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
