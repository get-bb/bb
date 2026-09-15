import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import {
  type BbAppManagedConfig,
  type BbAppManagedEnvFile,
  bbAppManagedEnvFileSchema,
  parseBbAppManagedConfig,
} from "@bb/config/bb-app-managed-config";
import { hasErrorCode, ServerArchiveError } from "./errors.js";
import { lstatOrNull, moveFile } from "./fs-utils.js";
import {
  parseJsonText,
  readJsonFileText,
  writeJsonFileAtomically,
} from "./json-file.js";
import {
  SERVER_ARCHIVE_FILES_DIR_NAME,
  type ServerArchiveManifest,
} from "./manifest.js";
import { resolveRelativePath } from "./relative-path.js";
import { isServerOwnedPath } from "./server-owned-paths.js";

export const SERVER_IMPORT_BACKUP_DIR_NAME = "server-import-backup";

const MANAGED_CONFIG_PATH = "config.json";
const MANAGED_ENV_PATH = "env.json";
const SERVER_DATABASE_PATH = "bb.db";
const SERVER_DATABASE_PATHS = ["bb.db", "bb.db-wal", "bb.db-shm"] as const;
const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;
const MAX_ARCHIVE_NAME_ATTEMPTS = 100;

export type ImportedManagedConfig = Omit<
  BbAppManagedConfig,
  "customAcpAgents" | "customModels"
> & {
  customAcpAgents?: unknown[];
  customModels?: unknown[];
};

export interface MergeImportedManagedConfigArgs {
  importedConfig: ImportedManagedConfig;
  existingConfig: ImportedManagedConfig;
  localServerUrl: string | null;
}

export interface InstallImportedServerFilesArgs {
  stagingDir: string;
  dataDir: string;
  manifest: ServerArchiveManifest;
  localServerUrl: string | null;
}

export interface InstallImportedServerFilesResult {
  importedEntries: string[];
  backups: string[];
}

export interface RemoveImportedServerFilesArgs {
  dataDir: string;
  importedEntries: readonly string[];
}

export interface ArchiveExistingServerDataArgs {
  dataDir: string;
  now: number;
}

export function mergeImportedManagedConfig(
  args: MergeImportedManagedConfigArgs,
): ImportedManagedConfig {
  const { existingConfig, importedConfig } = args;
  const merged: ImportedManagedConfig = {};
  const configValues = { ...existingConfig.config, ...importedConfig.config };
  if (Object.keys(configValues).length > 0) {
    merged.config = configValues;
  }
  const customModels =
    importedConfig.customModels ?? existingConfig.customModels;
  if (customModels !== undefined && customModels.length > 0) {
    merged.customModels = customModels;
  }
  const customAcpAgents =
    importedConfig.customAcpAgents ?? existingConfig.customAcpAgents;
  if (customAcpAgents !== undefined && customAcpAgents.length > 0) {
    merged.customAcpAgents = customAcpAgents;
  }
  const sharedSkillRoots =
    importedConfig.sharedSkillRoots ?? existingConfig.sharedSkillRoots;
  if (sharedSkillRoots !== undefined) {
    merged.sharedSkillRoots = sharedSkillRoots;
  }
  if (args.localServerUrl !== null) {
    merged.serverUrl = args.localServerUrl;
  }
  return merged;
}

function mergeImportedManagedEnv(
  importedEnv: BbAppManagedEnvFile,
  existingEnv: BbAppManagedEnvFile,
): BbAppManagedEnvFile {
  const env = { ...existingEnv.env, ...importedEnv.env };
  return Object.keys(env).length > 0 ? { env } : {};
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseImportedManagedConfig(value: unknown): ImportedManagedConfig {
  const config: ImportedManagedConfig = { ...parseBbAppManagedConfig(value) };
  if (isJsonObject(value)) {
    if (Array.isArray(value.customAcpAgents)) {
      config.customAcpAgents = value.customAcpAgents;
    }
    if (Array.isArray(value.customModels)) {
      config.customModels = value.customModels;
    }
  }
  return config;
}

async function readManagedJsonFile<T>(
  path: string,
  parse: (value: unknown) => T,
  source: "imported" | "existing",
): Promise<T | null> {
  const text = await readJsonFileText(path);
  if (text === null) {
    return null;
  }
  try {
    return parse(parseJsonText(path, text));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `Invalid ${source} ${basename(path)} at ${path}: ${detail}`;
    throw source === "imported"
      ? new ServerArchiveError("corrupt", message, { cause: error })
      : new Error(message, { cause: error });
  }
}

async function assertNoServerData(dataDir: string): Promise<void> {
  for (const relativePath of [
    ...SERVER_DATABASE_PATHS,
    SERVER_IMPORT_BACKUP_DIR_NAME,
  ]) {
    const path = join(dataDir, relativePath);
    if ((await lstatOrNull(path)) !== null) {
      throw new ServerArchiveError(
        "server_data_exists",
        `${path} already exists`,
      );
    }
  }
}

async function assertStagedFiles(
  filesDir: string,
  manifest: ServerArchiveManifest,
): Promise<void> {
  for (const entry of manifest.entries) {
    const stats = await lstatOrNull(resolveRelativePath(filesDir, entry.path));
    if (stats?.isFile() !== true || stats.size !== entry.size) {
      throw new ServerArchiveError(
        "corrupt",
        `Staged file ${entry.path} is missing or does not match the manifest`,
      );
    }
  }
}

async function assertInstallableDestination(
  dataDir: string,
  relativePath: string,
  verifiedDirectories: Set<string>,
): Promise<void> {
  const segments = relativePath.split("/");
  let current = dataDir;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    if (verifiedDirectories.has(current)) {
      continue;
    }
    const stats = await lstatOrNull(current);
    if (stats !== null && !stats.isDirectory()) {
      throw new ServerArchiveError(
        "unsafe_entry",
        `Cannot import ${relativePath}: ${current} is not a directory`,
      );
    }
    verifiedDirectories.add(current);
  }
  const destination = await lstatOrNull(
    resolveRelativePath(dataDir, relativePath),
  );
  if (destination?.isDirectory() === true) {
    throw new ServerArchiveError(
      "server_data_exists",
      `Cannot import ${relativePath}: a directory exists at that path`,
    );
  }
}

async function backUpExistingFile(
  dataDir: string,
  relativePath: string,
  mode: "move" | "copy",
  result: InstallImportedServerFilesResult,
): Promise<void> {
  const destination = resolveRelativePath(dataDir, relativePath);
  if ((await lstatOrNull(destination)) === null) {
    return;
  }
  const backupPath = resolveRelativePath(
    join(dataDir, SERVER_IMPORT_BACKUP_DIR_NAME),
    relativePath,
  );
  await mkdir(dirname(backupPath), { recursive: true });
  if (mode === "move") {
    await rename(destination, backupPath);
  } else {
    await copyFile(destination, backupPath);
  }
  result.backups.push(relativePath);
}

async function installStagedFile(
  dataDir: string,
  filesDir: string,
  relativePath: string,
  result: InstallImportedServerFilesResult,
): Promise<void> {
  const destination = resolveRelativePath(dataDir, relativePath);
  await backUpExistingFile(dataDir, relativePath, "move", result);
  await mkdir(dirname(destination), { recursive: true });
  await moveFile(resolveRelativePath(filesDir, relativePath), destination);
  result.importedEntries.push(relativePath);
}

async function writeManagedFile(
  dataDir: string,
  relativePath: string,
  value: unknown,
  result: InstallImportedServerFilesResult,
): Promise<void> {
  await backUpExistingFile(dataDir, relativePath, "copy", result);
  await writeJsonFileAtomically(join(dataDir, relativePath), value);
  result.importedEntries.push(relativePath);
}

function assertServerOwnedPaths(paths: readonly string[], label: string): void {
  for (const path of paths) {
    if (!isServerOwnedPath(path)) {
      throw new ServerArchiveError(
        "unsafe_entry",
        `${label} ${JSON.stringify(path)} is not a server-owned path`,
      );
    }
  }
}

export async function installImportedServerFiles(
  args: InstallImportedServerFilesArgs,
): Promise<InstallImportedServerFilesResult> {
  const dataDir = resolve(args.dataDir);
  const filesDir = join(
    resolve(args.stagingDir),
    SERVER_ARCHIVE_FILES_DIR_NAME,
  );
  assertServerOwnedPaths(
    args.manifest.entries.map((entry) => entry.path),
    "Archive entry",
  );
  await mkdir(dataDir, { recursive: true });
  await assertNoServerData(dataDir);
  await assertStagedFiles(filesDir, args.manifest);
  const verifiedDirectories = new Set<string>();
  for (const relativePath of [
    ...args.manifest.entries.map((entry) => entry.path),
    MANAGED_CONFIG_PATH,
    MANAGED_ENV_PATH,
  ]) {
    await assertInstallableDestination(
      dataDir,
      relativePath,
      verifiedDirectories,
    );
  }

  const manifestPaths = new Set(
    args.manifest.entries.map((entry) => entry.path),
  );
  const importedConfig = manifestPaths.has(MANAGED_CONFIG_PATH)
    ? await readManagedJsonFile(
        resolveRelativePath(filesDir, MANAGED_CONFIG_PATH),
        parseImportedManagedConfig,
        "imported",
      )
    : null;
  const existingConfig = await readManagedJsonFile(
    join(dataDir, MANAGED_CONFIG_PATH),
    parseImportedManagedConfig,
    "existing",
  );
  const mergedConfig =
    importedConfig === null &&
    existingConfig === null &&
    args.localServerUrl === null
      ? null
      : mergeImportedManagedConfig({
          importedConfig: importedConfig ?? {},
          existingConfig: existingConfig ?? {},
          localServerUrl: args.localServerUrl,
        });
  const importedEnv = manifestPaths.has(MANAGED_ENV_PATH)
    ? await readManagedJsonFile(
        resolveRelativePath(filesDir, MANAGED_ENV_PATH),
        (value) => bbAppManagedEnvFileSchema.parse(value),
        "imported",
      )
    : null;
  const mergedEnv =
    importedEnv === null
      ? null
      : mergeImportedManagedEnv(
          importedEnv,
          (await readManagedJsonFile(
            join(dataDir, MANAGED_ENV_PATH),
            (value) => bbAppManagedEnvFileSchema.parse(value),
            "existing",
          )) ?? {},
        );

  const result: InstallImportedServerFilesResult = {
    importedEntries: [],
    backups: [],
  };
  try {
    for (const relativePath of manifestPaths) {
      if (
        relativePath !== MANAGED_CONFIG_PATH &&
        relativePath !== MANAGED_ENV_PATH &&
        relativePath !== SERVER_DATABASE_PATH
      ) {
        await installStagedFile(dataDir, filesDir, relativePath, result);
      }
    }
    if (mergedConfig !== null) {
      await writeManagedFile(
        dataDir,
        MANAGED_CONFIG_PATH,
        mergedConfig,
        result,
      );
    }
    if (mergedEnv !== null) {
      await writeManagedFile(dataDir, MANAGED_ENV_PATH, mergedEnv, result);
    }
    if (manifestPaths.has(SERVER_DATABASE_PATH)) {
      await installStagedFile(dataDir, filesDir, SERVER_DATABASE_PATH, result);
    }
  } catch (error) {
    await removeImportedServerFiles({
      dataDir,
      importedEntries: result.importedEntries,
    });
    throw error;
  }
  return result;
}

async function listBackupFiles(
  backupDir: string,
  relativeDir: string | null,
): Promise<string[]> {
  const directory =
    relativeDir === null
      ? backupDir
      : resolveRelativePath(backupDir, relativeDir);
  let children;
  try {
    children = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (relativeDir === null && hasErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const child of children) {
    const relativePath =
      relativeDir === null ? child.name : `${relativeDir}/${child.name}`;
    if (child.isDirectory()) {
      files.push(...(await listBackupFiles(backupDir, relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

async function removeEmptyParentDirectories(
  dataDir: string,
  importedEntries: readonly string[],
): Promise<void> {
  const directories = new Set<string>();
  for (const entry of importedEntries) {
    for (
      let parent = posix.dirname(entry);
      parent !== ".";
      parent = posix.dirname(parent)
    ) {
      directories.add(parent);
    }
  }
  const deepestFirst = [...directories].sort(
    (left, right) => right.split("/").length - left.split("/").length,
  );
  for (const directory of deepestFirst) {
    try {
      await rmdir(resolveRelativePath(dataDir, directory));
    } catch (error) {
      if (
        !hasErrorCode(error, "ENOTEMPTY") &&
        !hasErrorCode(error, "EEXIST") &&
        !hasErrorCode(error, "ENOENT") &&
        !hasErrorCode(error, "ENOTDIR")
      ) {
        throw error;
      }
    }
  }
}

export async function removeImportedServerFiles(
  args: RemoveImportedServerFilesArgs,
): Promise<void> {
  const dataDir = resolve(args.dataDir);
  assertServerOwnedPaths(args.importedEntries, "Imported entry");
  for (const entry of args.importedEntries) {
    const path = resolveRelativePath(dataDir, entry);
    await rm(path, { force: true, recursive: true });
    if (entry.endsWith(".db")) {
      for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
        await rm(`${path}${suffix}`, { force: true });
      }
    }
  }
  const backupDir = join(dataDir, SERVER_IMPORT_BACKUP_DIR_NAME);
  for (const backup of await listBackupFiles(backupDir, null)) {
    const destination = resolveRelativePath(dataDir, backup);
    await mkdir(dirname(destination), { recursive: true });
    await rename(resolveRelativePath(backupDir, backup), destination);
  }
  await rm(backupDir, { force: true, recursive: true });
  await removeEmptyParentDirectories(dataDir, args.importedEntries);
}

export async function discardImportBackups(dataDir: string): Promise<void> {
  const backupDir = join(resolve(dataDir), SERVER_IMPORT_BACKUP_DIR_NAME);
  const stats = await lstatOrNull(backupDir);
  if (stats === null) {
    return;
  }
  if (!stats.isDirectory()) {
    await unlink(backupDir);
    return;
  }
  await rm(backupDir, { force: true, recursive: true });
}

function formatArchiveTimestamp(now: number): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join("-");
}

export async function archiveExistingServerData(
  args: ArchiveExistingServerDataArgs,
): Promise<string> {
  const dataDir = resolve(args.dataDir);
  const basePath = `${dataDir}.before-move-${formatArchiveTimestamp(args.now)}`;
  for (let attempt = 1; attempt <= MAX_ARCHIVE_NAME_ATTEMPTS; attempt += 1) {
    const archivedPath =
      attempt === 1 ? basePath : `${basePath}-${String(attempt)}`;
    if ((await lstatOrNull(archivedPath)) !== null) {
      continue;
    }
    try {
      await rename(dataDir, archivedPath);
      return archivedPath;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST") && !hasErrorCode(error, "ENOTEMPTY")) {
        throw error;
      }
    }
  }
  throw new Error(`Could not choose an archive path for ${dataDir}`);
}
