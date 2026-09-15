import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { readBbAppRuntimeFile } from "@bb/config/app-runtime-file";
import {
  type BbAppManagedConfig,
  formatBbAppConfigPath,
  parseBbAppManagedConfig,
} from "@bb/config/bb-app-managed-config";
import { parseDataDirEnvValue, resolveProdDataDir } from "@bb/config/runtime";
import { isProcessRunning } from "@bb/config/verified-process-stop";
import {
  assertServerArchiveFormat,
  extractServerArchive,
  installImportedServerFiles,
  discardImportBackups,
  readServerImportFile,
  readServerImportJournalFile,
  removeServerConnectHoldFile,
  removeServerImportJournalFile,
  rollBackServerImport,
  SERVER_IMPORT_FILE_NAME,
  SERVER_MOVED_FILE_NAME,
  ServerArchiveError,
  type ServerMovedFile,
  writeServerConnectHoldFile,
  writeServerImportFile,
  writeServerMovedFile,
} from "@bb/server-archive";
import { z } from "zod";

const SERVER_DATABASE_FILE_NAME = "bb.db";
const MOVED_DAEMON_CONFIG_KEYS: readonly string[] = [
  "serverUrl",
  "serverHeaders",
  "machineCredential",
  "connectMachineId",
];
const managedConfigObjectSchema = z.record(z.string(), z.unknown());
const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;
const OLD_COPY_PROTECTED_ENTRIES: ReadonlySet<string> = new Set([
  "auth.json",
  "bb-app-runtime.json",
  "checkouts",
  "config.json",
  "daemon.lock",
  "env.json",
  "host-id",
  "last-server-move.json",
  "logs",
  "npm",
  "personal-workspaces",
  "runtime",
  "server-moved.json",
  "thread-storage",
  "worktrees",
]);

const MOVED_SERVER_PROBE_TIMEOUT_MS = 5_000;
const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/u;

const healthResponseSchema = z.object({
  ok: z.literal(true),
  serverMove: z.object({ state: z.string() }).optional(),
});

export interface ServerImportArgs {
  archivePath: string;
  dataDir: string;
  confirm: (message: string) => Promise<boolean>;
  now: () => number;
  cliVersion: string;
}

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (match === null) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return right.length - left.length;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = NUMERIC_IDENTIFIER_PATTERN.test(a);
    const bNumeric = NUMERIC_IDENTIFIER_PATTERN.test(b);
    if (aNumeric && bNumeric) {
      const delta = Number(a) - Number(b);
      if (delta !== 0) return delta;
      continue;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

export function isNewerBbVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (a === null || b === null) return false;
  for (let index = 0; index < 3; index += 1) {
    const delta = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  return comparePrerelease(a.prerelease, b.prerelease) > 0;
}

export type MovedServerProbeResult =
  | { kind: "running" }
  | { kind: "not-running" }
  | { kind: "unconfirmed"; status: number };

export interface ProbeMovedServerArgs {
  dataDir: string;
  lock: ServerMovedFile;
}

async function isHealthyServer(serverUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(MOVED_SERVER_PROBE_TIMEOUT_MS),
    });
    if (response.status !== 200) return false;
    const health = healthResponseSchema.safeParse(await response.json());
    return health.success && health.data.serverMove?.state !== "pending";
  } catch {
    return false;
  }
}

async function readMovedServerHeaders(
  dataDir: string,
): Promise<Record<string, string> | null> {
  const configPath = formatBbAppConfigPath(dataDir);
  const text = await readOptionalText(configPath);
  if (text === null) return null;
  const headers = parseManagedConfigText(configPath, text).config.serverHeaders;
  return headers === undefined || Object.keys(headers).length === 0
    ? null
    : headers;
}

export async function probeMovedServer(
  args: ProbeMovedServerArgs,
): Promise<MovedServerProbeResult> {
  const serverUrl = args.lock.serverUrl.replace(/\/+$/u, "");
  const headers =
    args.lock.mode === "connect"
      ? await readMovedServerHeaders(args.dataDir)
      : null;
  if (headers === null) {
    return (await isHealthyServer(serverUrl))
      ? { kind: "running" }
      : { kind: "not-running" };
  }
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/v1/system/version`, {
      headers,
      signal: AbortSignal.timeout(MOVED_SERVER_PROBE_TIMEOUT_MS),
    });
  } catch {
    return { kind: "not-running" };
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 200) return { kind: "running" };
  if (response.status === 503) return { kind: "not-running" };
  return { kind: "unconfirmed", status: response.status };
}

export interface ServerImportResult {
  dataDir: string;
  archivePath: string;
  bbVersion: string;
  sourceDataDir: string;
  sourceServerHostId: string | null;
  importedEntries: string[];
  rolledBackInterruptedImport: boolean;
}

export interface DeleteOldServerCopyResult {
  dataDir: string;
  deleted: boolean;
  deletedEntries: string[];
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

export function isDefaultDataDir(dataDir: string): boolean {
  return dataDir === resolve(resolveProdDataDir({ homeDir: homedir() }));
}

export function resolveLocalDataDir(dataDirOption: string | undefined): string {
  const homeDir = homedir();
  if (dataDirOption !== undefined) {
    if (dataDirOption.trim().length === 0) {
      throw new Error("--data-dir must not be empty.");
    }
    return resolve(
      parseDataDirEnvValue({ homeDir, rawDataDir: dataDirOption }),
    );
  }
  const configured = process.env.BB_DATA_DIR;
  return resolve(
    configured === undefined || configured.trim().length === 0
      ? resolveProdDataDir({ homeDir })
      : parseDataDirEnvValue({ homeDir, rawDataDir: configured }),
  );
}

async function assertNoServerDatabase(dataDir: string): Promise<void> {
  if (await pathExists(join(dataDir, SERVER_DATABASE_FILE_NAME))) {
    throw new Error(
      `${dataDir} already has a bb server database (${SERVER_DATABASE_FILE_NAME}). Import into a data directory without a server, such as --data-dir ~/.bb-imported.`,
    );
  }
}

async function assertNoRunningBb(dataDir: string): Promise<void> {
  const runtime = await readBbAppRuntimeFile(dataDir);
  if (runtime !== null && isProcessRunning(runtime.pid)) {
    throw new Error(
      `bb is running from ${dataDir} (pid ${String(runtime.pid)}). Stop it with bb-app stop or quit the desktop app, then try again.`,
    );
  }
}

async function assertArchiveFile(archivePath: string): Promise<void> {
  let stats;
  try {
    stats = await stat(archivePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new Error(`${archivePath} does not exist.`);
    }
    throw error;
  }
  if (!stats.isFile()) throw new Error(`${archivePath} is not a file.`);
}

function describeUnsafeImport(archivePath: string, error: unknown): unknown {
  if (error instanceof ServerArchiveError && error.code === "unsafe_entry") {
    return new Error(
      `Refusing to import ${archivePath}: ${error.message}. Nothing was imported.`,
    );
  }
  return error;
}

async function rollBackInterruptedImport(dataDir: string): Promise<void> {
  await rollBackServerImport(dataDir);
  await removeServerConnectHoldFile(dataDir);
  const marker = await readServerImportFile(dataDir);
  if (marker?.kind === "manual") {
    await rm(join(dataDir, SERVER_IMPORT_FILE_NAME), { force: true });
  }
}

export async function importServerArchive(
  args: ServerImportArgs,
): Promise<ServerImportResult | null> {
  const { archivePath, dataDir } = args;
  await assertArchiveFile(archivePath);
  const interruptedImport = await readServerImportJournalFile(dataDir);
  if (interruptedImport === null) {
    await assertNoServerDatabase(dataDir);
  }
  await assertNoRunningBb(dataDir);
  await assertServerArchiveFormat(archivePath);
  if (
    !(await args.confirm(
      interruptedImport === null
        ? `Import the bb server from ${archivePath} into ${dataDir}?`
        : `Roll back the interrupted import in ${dataDir}, then import the bb server from ${archivePath}?`,
    ))
  ) {
    return null;
  }
  if (interruptedImport !== null) {
    await rollBackInterruptedImport(dataDir);
    await assertNoServerDatabase(dataDir);
  }
  const parentDir = dirname(dataDir);
  await mkdir(parentDir, { recursive: true });
  const stagingDir = await mkdtemp(
    join(parentDir, `.${basename(dataDir)}-server-import-`),
  );
  try {
    const manifest = await extractServerArchive({
      archivePath,
      destinationDir: stagingDir,
    }).catch((error: unknown) => {
      throw describeUnsafeImport(archivePath, error);
    });
    if (!manifest.serverMoveExperiment) {
      throw new Error(
        'This export came from a server with the "Server move" experiment off. Turn on the "Server move" experiment in Settings → Experiments, or run bb settings experiment serverMove true, on that server, then export again.',
      );
    }
    if (isNewerBbVersion(manifest.bbVersion, args.cliVersion)) {
      throw new Error(
        `This export came from bb ${manifest.bbVersion}; install that version or newer before importing.`,
      );
    }
    const installed = await installImportedServerFiles({
      stagingDir,
      dataDir,
      manifest,
      localServerUrl: null,
    }).catch((error: unknown) => {
      throw describeUnsafeImport(archivePath, error);
    });
    try {
      await writeServerConnectHoldFile(dataDir, {
        version: 1,
        reason: "manual-import",
        createdAt: args.now(),
      });
      await writeServerImportFile(dataDir, {
        version: 1,
        kind: "manual",
        moveId: null,
        activationToken: null,
        sourceDataDir: manifest.sourceDataDir,
        sourceServerHostId: manifest.sourceServerHostId,
        targetHostId: null,
        serverUrl: null,
        importedEntries: installed.importedEntries,
        createdAt: args.now(),
        fixupsAppliedAt: null,
      });
    } catch (error) {
      await removeServerConnectHoldFile(dataDir);
      await rollBackServerImport(dataDir);
      throw error;
    }
    await removeServerImportJournalFile(dataDir);
    await discardImportBackups(dataDir);
    return {
      dataDir,
      archivePath,
      bbVersion: manifest.bbVersion,
      sourceDataDir: manifest.sourceDataDir,
      sourceServerHostId: manifest.sourceServerHostId,
      importedEntries: installed.importedEntries,
      rolledBackInterruptedImport: interruptedImport !== null,
    };
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

async function writeTextAtomically(path: string, text: string): Promise<void> {
  const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, text, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

interface ParsedManagedConfig {
  raw: Record<string, unknown>;
  config: BbAppManagedConfig;
}

function parseManagedConfigText(
  path: string,
  text: string,
): ParsedManagedConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid JSON. Fix it, then unlock again.`, {
      cause: error,
    });
  }
  let config: BbAppManagedConfig;
  try {
    config = parseBbAppManagedConfig(raw);
  } catch (error) {
    const detail =
      error instanceof z.ZodError ? z.prettifyError(error) : String(error);
    throw new Error(
      `${path} is not a valid bb-app config. Fix it, then unlock again.\n${detail}`,
    );
  }
  return { raw: managedConfigObjectSchema.parse(raw), config };
}

export async function unlockServerCopy(dataDir: string): Promise<string[]> {
  const lockPath = join(dataDir, SERVER_MOVED_FILE_NAME);
  const configPath = formatBbAppConfigPath(dataDir);
  const originalText = await readOptionalText(configPath);
  if (originalText === null) {
    await rm(lockPath, { force: true });
    return [];
  }
  const current = parseManagedConfigText(configPath, originalText).raw;
  const removedConfigKeys = MOVED_DAEMON_CONFIG_KEYS.filter((key) =>
    Object.hasOwn(current, key),
  );
  if (removedConfigKeys.length === 0) {
    await rm(lockPath, { force: true });
    return [];
  }
  const next = Object.fromEntries(
    Object.entries(current).filter(
      ([key]) => !MOVED_DAEMON_CONFIG_KEYS.includes(key),
    ),
  );
  parseBbAppManagedConfig(next);
  await writeTextAtomically(configPath, `${JSON.stringify(next, null, 2)}\n`);
  try {
    await rm(lockPath, { force: true });
  } catch (error) {
    await writeTextAtomically(configPath, originalText);
    throw error;
  }
  return removedConfigKeys;
}

function isContainedIn(root: string, candidate: string): boolean {
  return candidate.startsWith(`${root}${sep}`);
}

export async function deleteOldServerCopy(
  dataDir: string,
  lock: ServerMovedFile,
): Promise<DeleteOldServerCopyResult> {
  const root = resolve(dataDir);
  const deletedEntries: string[] = [];
  for (const entry of lock.oldCopyEntries) {
    const target = resolve(root, ...entry.split("/"));
    const topLevel = entry.split("/")[0] ?? entry;
    if (
      !isContainedIn(root, target) ||
      OLD_COPY_PROTECTED_ENTRIES.has(topLevel)
    ) {
      continue;
    }
    await rm(target, { force: true, recursive: true });
    if (entry.endsWith(".db")) {
      for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
        await rm(`${target}${suffix}`, { force: true });
      }
    }
    deletedEntries.push(entry);
  }
  await writeServerMovedFile(dataDir, { ...lock, oldCopyEntries: [] });
  return { dataDir, deleted: true, deletedEntries };
}
