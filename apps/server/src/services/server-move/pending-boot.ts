import type { Dirent } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  countAppliedMigrations,
  getAppSettings,
  getHost,
  getPluginKvValue,
  rerootServerOwnedPluginPaths,
  setAppSettings,
  swapServerHostRoles,
  type DbConnection,
  type RerootServerOwnedPathsResult,
  type SwapServerHostRolesResult,
} from "@bb/db";
import { appSettingsSchema } from "@bb/domain";
import {
  readLastServerMoveFile,
  readServerImportFile,
  SERVER_IMPORT_FILE_NAME,
  writeLastServerMoveFile,
  writeServerImportFile,
  type ServerImportFile,
} from "@bb/server-archive";
import { z } from "zod";
import type { AppDeps, ServerLogger } from "../../types.js";
import { readPrimaryHostIdFromDataDir } from "../hosts/primary-host.js";
import {
  oldServerAddress,
  readServerManagedFiles,
  rewriteManagedAddresses,
  writeTextAtomically,
  type ManagedAddressKey,
} from "./managed-files.js";

const PLUGIN_SNAPSHOTS_RELATIVE_PATH = ["plugins", "snapshots"] as const;
const PREVIOUS_REGISTRATION_FILE_NAME = "previous-registration.json";
const REGISTRATION_PATH_KEYS = ["rootDir", "sourcePath"] as const;
const CONNECT_PLUGIN_ID = "connect";
const CONNECT_CREDENTIAL_KEY = "credential";

const connectCredentialUrlSchema = z
  .object({ serverUrl: z.string().min(1) })
  .passthrough();
const registrationObjectSchema = z.record(z.string(), z.unknown());

export interface PendingServerMove {
  moveId: string;
  sourceServerHostId: string | null;
  targetHostId: string | null;
}

export interface PendingServerMoveVerification {
  message: string | null;
  moveId: string;
  verified: boolean;
}

export interface ServerImportFixupResult {
  machineServerUrlSet: boolean;
  managedAddresses: ManagedAddressKey[];
  registrationFiles: number;
  rerooted: RerootServerOwnedPathsResult;
}

export interface ApplyServerImportFixupsArgs {
  dataDir: string;
  db: DbConnection;
  marker: ServerImportFile;
}

export interface ApplyServerImportAtBootArgs {
  dataDir: string;
  db: DbConnection;
  logger: Pick<ServerLogger, "info">;
  now: number;
}

export interface ServerImportBootResult {
  manualImportPending: boolean;
  pendingMove: PendingServerMove | null;
}

export type ManualServerImportCompletion =
  | "completed"
  | "not-pending"
  | "waiting";

export interface CompleteManualServerImportArgs {
  dataDir: string;
  db: DbConnection;
  hostId: string;
  logger: Pick<ServerLogger, "info">;
  now: number;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readDirectoryOrEmpty(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

function rerootPath(
  value: string,
  fromRoot: string,
  toRoot: string,
): string | null {
  const underFromRoot = value === fromRoot || value.startsWith(`${fromRoot}/`);
  const alreadyUnderToRoot =
    toRoot.startsWith(`${fromRoot}/`) &&
    (value === toRoot || value.startsWith(`${toRoot}/`));
  if (!underFromRoot || alreadyUnderToRoot) {
    return null;
  }
  return `${toRoot}${value.slice(fromRoot.length)}`;
}

async function rerootRegistrationFile(
  path: string,
  fromRoot: string,
  toRoot: string,
): Promise<boolean> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw new Error(`Invalid plugin snapshot registration at ${path}`, {
      cause: error,
    });
  }
  const parsed = registrationObjectSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid plugin snapshot registration at ${path}`);
  }
  const registration = { ...parsed.data };
  let changed = false;
  for (const key of REGISTRATION_PATH_KEYS) {
    const value = registration[key];
    if (typeof value !== "string") {
      continue;
    }
    const rerooted = rerootPath(value, fromRoot, toRoot);
    if (rerooted !== null) {
      registration[key] = rerooted;
      changed = true;
    }
  }
  if (changed) {
    await writeTextAtomically(path, JSON.stringify(registration));
  }
  return changed;
}

async function rerootPreviousRegistrationFiles(args: {
  dataDir: string;
  fromRoot: string;
  toRoot: string;
}): Promise<number> {
  const snapshotsDir = join(args.dataDir, ...PLUGIN_SNAPSHOTS_RELATIVE_PATH);
  let changedFiles = 0;
  for (const plugin of await readDirectoryOrEmpty(snapshotsDir)) {
    if (!plugin.isDirectory()) {
      continue;
    }
    const pluginDir = join(snapshotsDir, plugin.name);
    for (const snapshot of await readDirectoryOrEmpty(pluginDir)) {
      if (!snapshot.isDirectory()) {
        continue;
      }
      const changed = await rerootRegistrationFile(
        join(pluginDir, snapshot.name, PREVIOUS_REGISTRATION_FILE_NAME),
        args.fromRoot,
        args.toRoot,
      );
      if (changed) {
        changedFiles += 1;
      }
    }
  }
  return changedFiles;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isConnectServerUrl(db: DbConnection, serverUrl: string): boolean {
  const raw = getPluginKvValue(db, CONNECT_PLUGIN_ID, CONNECT_CREDENTIAL_KEY);
  if (raw === undefined) {
    return false;
  }
  let credential: unknown;
  try {
    credential = JSON.parse(raw);
  } catch {
    return false;
  }
  const parsed = connectCredentialUrlSchema.safeParse(credential);
  return (
    parsed.success &&
    normalizeUrl(parsed.data.serverUrl) === normalizeUrl(serverUrl)
  );
}

function directMoveServerUrl(
  db: DbConnection,
  serverUrl: string | null,
): string | null {
  if (serverUrl === null || isConnectServerUrl(db, serverUrl)) {
    return null;
  }
  const parsed = appSettingsSchema.shape.machineServerUrl.safeParse(
    normalizeUrl(serverUrl),
  );
  return parsed.success ? parsed.data : null;
}

function applyDirectMachineServerUrl(
  db: DbConnection,
  serverUrl: string,
): boolean {
  const settings = getAppSettings(db);
  if (settings.machineServerUrl === serverUrl) {
    return false;
  }
  setAppSettings(db, { ...settings, machineServerUrl: serverUrl });
  return true;
}

async function rewriteOldServerAddresses(args: {
  dataDir: string;
  db: DbConnection;
  serverUrl: string;
}): Promise<ManagedAddressKey[]> {
  const managed = await readServerManagedFiles(args.dataDir);
  const oldAddress = oldServerAddress(args.db, managed);
  if (oldAddress === null) {
    return [];
  }
  return rewriteManagedAddresses({
    dataDir: args.dataDir,
    fromOrigin: oldAddress.origin,
    toUrl: args.serverUrl,
  });
}

export async function applyServerImportFixups(
  args: ApplyServerImportFixupsArgs,
): Promise<ServerImportFixupResult> {
  const fromRoot = resolve(args.marker.sourceDataDir);
  const toRoot = resolve(args.dataDir);
  const rerooted = rerootServerOwnedPluginPaths(args.db, { fromRoot, toRoot });
  const registrationFiles =
    fromRoot === toRoot
      ? 0
      : await rerootPreviousRegistrationFiles({
          dataDir: args.dataDir,
          fromRoot,
          toRoot,
        });
  const directServerUrl = directMoveServerUrl(args.db, args.marker.serverUrl);
  if (directServerUrl === null) {
    return {
      machineServerUrlSet: false,
      managedAddresses: [],
      registrationFiles,
      rerooted,
    };
  }
  const managedAddresses = await rewriteOldServerAddresses({
    dataDir: args.dataDir,
    db: args.db,
    serverUrl: directServerUrl,
  });
  return {
    machineServerUrlSet: applyDirectMachineServerUrl(args.db, directServerUrl),
    managedAddresses,
    registrationFiles,
    rerooted,
  };
}

function swapImportedHostRoles(args: {
  db: DbConnection;
  marker: ServerImportFile;
  now: number;
  targetHostId: string;
}): SwapServerHostRolesResult {
  return swapServerHostRoles(args.db, {
    now: args.now,
    sourceServerHostId: args.marker.sourceServerHostId,
    targetHostId: args.targetHostId,
  });
}

async function finishManualImport(args: {
  dataDir: string;
  db: DbConnection;
  logger: Pick<ServerLogger, "info">;
  marker: ServerImportFile;
  now: number;
  targetHostId: string;
}): Promise<SwapServerHostRolesResult> {
  const hostRoles = swapImportedHostRoles(args);
  await rm(join(args.dataDir, SERVER_IMPORT_FILE_NAME), { force: true });
  args.logger.info(
    { hostRoles, targetHostId: args.targetHostId },
    "Finished importing server data",
  );
  return hostRoles;
}

export async function applyServerImportAtBoot(
  args: ApplyServerImportAtBootArgs,
): Promise<ServerImportBootResult> {
  const marker = await readServerImportFile(args.dataDir);
  if (marker === null) {
    return { manualImportPending: false, pendingMove: null };
  }
  const targetHostId =
    marker.targetHostId ??
    readPrimaryHostIdFromDataDir({ dataDir: args.dataDir });
  if (marker.fixupsAppliedAt === null) {
    const result = await applyServerImportFixups({
      dataDir: args.dataDir,
      db: args.db,
      marker,
    });
    const hostRoles =
      marker.kind === "move" && targetHostId !== null
        ? swapImportedHostRoles({
            db: args.db,
            marker,
            now: args.now,
            targetHostId,
          })
        : null;
    await writeServerImportFile(args.dataDir, {
      ...marker,
      fixupsAppliedAt: args.now,
    });
    args.logger.info(
      { hostRoles, kind: marker.kind, moveId: marker.moveId, result },
      "Applied imported server data fixups",
    );
  }
  if (marker.kind === "manual") {
    if (targetHostId === null) {
      args.logger.info(
        {},
        "Imported server data is waiting for this machine to enroll before it swaps machine roles",
      );
      return { manualImportPending: true, pendingMove: null };
    }
    await finishManualImport({
      dataDir: args.dataDir,
      db: args.db,
      logger: args.logger,
      marker,
      now: args.now,
      targetHostId,
    });
    return { manualImportPending: false, pendingMove: null };
  }
  if (marker.moveId === null) {
    throw new Error(`${SERVER_IMPORT_FILE_NAME} for a move has no moveId`);
  }
  return {
    manualImportPending: false,
    pendingMove: {
      moveId: marker.moveId,
      sourceServerHostId: marker.sourceServerHostId,
      targetHostId,
    },
  };
}

export async function completeManualServerImport(
  args: CompleteManualServerImportArgs,
): Promise<ManualServerImportCompletion> {
  if (readPrimaryHostIdFromDataDir({ dataDir: args.dataDir }) !== args.hostId) {
    return "waiting";
  }
  const marker = await readServerImportFile(args.dataDir);
  if (
    marker === null ||
    marker.kind !== "manual" ||
    marker.fixupsAppliedAt === null
  ) {
    return "not-pending";
  }
  await finishManualImport({
    dataDir: args.dataDir,
    db: args.db,
    logger: args.logger,
    marker,
    now: args.now,
    targetHostId: args.hostId,
  });
  return "completed";
}

export interface CreateManualServerImportCompletionArgs {
  deps: Pick<AppDeps, "config" | "db" | "hub" | "logger">;
  pending: boolean;
}

export function createManualServerImportCompletion(
  args: CreateManualServerImportCompletionArgs,
): (hostId: string) => Promise<void> {
  let pending = args.pending;
  return async (hostId) => {
    if (!pending) {
      return;
    }
    try {
      const outcome = await completeManualServerImport({
        dataDir: args.deps.config.dataDir,
        db: args.deps.db,
        hostId,
        logger: args.deps.logger,
        now: Date.now(),
      });
      if (outcome === "waiting") {
        return;
      }
      pending = false;
      if (outcome === "completed") {
        args.deps.hub.notifyHost(hostId, ["host-connected"]);
      }
    } catch (error) {
      args.deps.logger.warn(
        { err: error, hostId },
        "Could not finish importing server data",
      );
    }
  };
}

export interface RepairLastServerMoveArgs {
  dataDir: string;
  db: DbConnection;
  logger: Pick<ServerLogger, "info" | "warn">;
}

export async function repairLastServerMoveHostName(
  args: RepairLastServerMoveArgs,
): Promise<boolean> {
  let lastMove: Awaited<ReturnType<typeof readLastServerMoveFile>>;
  try {
    lastMove = await readLastServerMoveFile(args.dataDir);
  } catch (error) {
    args.logger.warn(
      { err: error },
      "Could not read last-server-move.json at boot",
    );
    return false;
  }
  if (lastMove === null || lastMove.fromHostName !== lastMove.fromHostId) {
    return false;
  }
  const host = getHost(args.db, lastMove.fromHostId);
  if (host === null || host.name === lastMove.fromHostName) {
    return false;
  }
  await writeLastServerMoveFile(args.dataDir, {
    ...lastMove,
    fromHostName: host.name,
  });
  args.logger.info(
    { fromHostId: lastMove.fromHostId, moveId: lastMove.moveId },
    "Restored the old server machine's name in last-server-move.json",
  );
  return true;
}

export function verifyPendingServerMove(
  db: DbConnection,
  pending: PendingServerMove,
): PendingServerMoveVerification {
  const problems: string[] = [];
  const migrationCount = countAppliedMigrations(db);
  if (migrationCount === 0) {
    problems.push("The imported database has no applied migrations");
  }
  for (const [label, hostId] of [
    ["new server machine", pending.targetHostId],
    ["old server machine", pending.sourceServerHostId],
  ] as const) {
    if (hostId !== null && getHost(db, hostId) === null) {
      problems.push(`The imported database has no row for the ${label}`);
    }
  }
  if (pending.targetHostId === null) {
    problems.push("The new server machine is unknown");
  }
  return {
    message: problems.length === 0 ? null : problems.join(". "),
    moveId: pending.moveId,
    verified: problems.length === 0,
  };
}
