import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveApplicationDataPath,
  resolveApplicationManifestPath,
  resolveAppsRootPath,
} from "@bb/config/app-storage-paths";
import {
  appDataPathSchema,
  applicationIdSchema,
  jsonValueSchema,
  type AppDataPath,
  type ApplicationId,
  type JsonValue,
} from "@bb/domain";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
} from "./command-dispatch-support.js";
import { isFsErrorWithCode } from "./fs-errors.js";
import { NON_IMAGE_FILE_SIZE_LIMIT_BYTES } from "./command-handlers/file-read.js";
import { resolveNonSymlinkDirectoryPath } from "./command-handlers/root-path.js";

export interface AppDataEntry {
  modifiedAtMs: number;
  path: AppDataPath;
  sizeBytes: number;
  value: JsonValue;
  version: string;
}

export interface ApplicationDataEntry {
  applicationId: ApplicationId;
  entry: AppDataEntry;
}

export interface ApplicationDataSnapshot {
  applicationIds: ApplicationId[];
  entries: ApplicationDataEntry[];
}

export interface ApplicationDataTarget {
  applicationId: ApplicationId;
  appDataPath: string;
}

interface AppDataTargetArgs {
  path: AppDataPath;
  target: ApplicationDataTarget;
}

interface ReadAppDataJsonArgs {
  bytes: Buffer;
  path: AppDataPath;
}

interface ListAppDataFilesArgs {
  appDataRoot: string;
  currentDirectory: string;
}

interface ListApplicationDataArgs {
  targets: readonly ApplicationDataTarget[];
}

interface ListApplicationDataTargetsFromRootArgs {
  appsRootPath: string;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function createFileTooLargeError(stat: Stats): CommandDispatchError {
  return new CommandDispatchError(
    "file_too_large",
    `File size ${stat.size} bytes exceeds the ${Math.floor(NON_IMAGE_FILE_SIZE_LIMIT_BYTES / (1024 * 1024))} MB limit`,
  );
}

function parseJsonValue(args: ReadAppDataJsonArgs): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(args.bytes.toString("utf8")));
  } catch {
    throw new CommandDispatchError(
      "invalid_json",
      `App data path ${args.path} does not contain valid JSON`,
    );
  }
}

function isIgnoredApplicationStorageEntry(entryName: string): boolean {
  return (
    entryName.startsWith(".tmp-app_") || entryName.startsWith(".delete-app_")
  );
}

async function isValidApplicationManifest(
  appsRootPath: string,
  applicationId: ApplicationId,
): Promise<boolean> {
  const dataDir = path.dirname(appsRootPath);
  try {
    const rawManifest = JSON.parse(
      await fs.readFile(
        resolveApplicationManifestPath(dataDir, applicationId),
        "utf8",
      ),
    );
    return (
      rawManifest !== null &&
      typeof rawManifest === "object" &&
      "id" in rawManifest &&
      rawManifest.id === applicationId &&
      "name" in rawManifest &&
      typeof rawManifest.name === "string" &&
      rawManifest.name.trim().length > 0
    );
  } catch {
    return false;
  }
}

async function resolveAppDataRoot(
  target: ApplicationDataTarget,
): Promise<string> {
  if (!path.isAbsolute(target.appDataPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "appDataPath must be absolute",
    );
  }
  const resolvedAppDataPath = await resolveNonSymlinkDirectoryPath({
    description: "App data directory",
    path: target.appDataPath,
  });
  const appRootPath = path.dirname(resolvedAppDataPath);
  if (!isPathWithinRoot(resolvedAppDataPath, appRootPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "App data path escapes app root",
    );
  }
  return resolvedAppDataPath;
}

export async function readApplicationDataFromTarget(
  args: AppDataTargetArgs,
): Promise<AppDataEntry> {
  const appDataPath = appDataPathSchema.parse(args.path);
  let appDataRoot: string;
  try {
    appDataRoot = await resolveAppDataRoot(args.target);
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      throw new ExpectedCommandDispatchError(
        "ENOENT",
        `Path does not exist: ${appDataPath}`,
      );
    }
    throw error;
  }
  const filePath = path.join(appDataRoot, ...appDataPath.split("/"));
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      throw new ExpectedCommandDispatchError(
        "ENOENT",
        `Path does not exist: ${appDataPath}`,
      );
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new CommandDispatchError(
      "invalid_path",
      `App data path ${appDataPath} is not a regular file`,
    );
  }
  if (stat.size > NON_IMAGE_FILE_SIZE_LIMIT_BYTES) {
    throw createFileTooLargeError(stat);
  }

  const bytes = await fs.readFile(filePath);
  return {
    modifiedAtMs: stat.mtimeMs,
    path: appDataPath,
    sizeBytes: stat.size,
    value: parseJsonValue({ bytes, path: appDataPath }),
    version: sha256(bytes),
  };
}

async function listAppDataFilePaths(
  args: ListAppDataFilesArgs,
): Promise<AppDataPath[]> {
  const entries = await fs.readdir(args.currentDirectory, {
    withFileTypes: true,
  });
  const paths: AppDataPath[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(args.currentDirectory, entry.name);
    if (entry.isDirectory()) {
      paths.push(
        ...(await listAppDataFilePaths({
          appDataRoot: args.appDataRoot,
          currentDirectory: entryPath,
        })),
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = path
      .relative(args.appDataRoot, entryPath)
      .split(path.sep)
      .join("/");
    const parsed = appDataPathSchema.safeParse(relativePath);
    if (parsed.success) {
      paths.push(parsed.data);
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

export async function listApplicationDataTargetsFromRoot(
  args: ListApplicationDataTargetsFromRootArgs,
): Promise<ApplicationDataTarget[]> {
  let appsRootPath;
  try {
    appsRootPath = await resolveNonSymlinkDirectoryPath({
      description: "Apps root",
      path: args.appsRootPath,
    });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const entries = await fs.readdir(appsRootPath, { withFileTypes: true });
  const dataDir = path.dirname(appsRootPath);
  const targets: ApplicationDataTarget[] = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      isIgnoredApplicationStorageEntry(entry.name)
    ) {
      continue;
    }
    const parsed = applicationIdSchema.safeParse(entry.name);
    if (!parsed.success) {
      continue;
    }
    if (!(await isValidApplicationManifest(appsRootPath, parsed.data))) {
      continue;
    }
    targets.push({
      applicationId: parsed.data,
      appDataPath: resolveApplicationDataPath(dataDir, parsed.data),
    });
  }
  return targets.sort((left, right) =>
    left.applicationId.localeCompare(right.applicationId),
  );
}

export async function listApplicationDataFromTargets(
  args: ListApplicationDataArgs,
): Promise<ApplicationDataSnapshot> {
  const applicationIds: ApplicationId[] = [];
  const snapshotEntries: ApplicationDataEntry[] = [];
  for (const target of args.targets) {
    applicationIds.push(target.applicationId);
    let resolvedAppDataRoot;
    try {
      resolvedAppDataRoot = await resolveAppDataRoot(target);
    } catch (error) {
      if (isFsErrorWithCode(error, "ENOENT")) {
        continue;
      }
      throw error;
    }
    const dataPaths = await listAppDataFilePaths({
      appDataRoot: resolvedAppDataRoot,
      currentDirectory: resolvedAppDataRoot,
    });
    for (const dataPath of dataPaths) {
      snapshotEntries.push({
        applicationId: target.applicationId,
        entry: await readApplicationDataFromTarget({
          path: dataPath,
          target,
        }),
      });
    }
  }

  applicationIds.sort((left, right) => left.localeCompare(right));
  snapshotEntries.sort((left, right) => {
    const appOrder = left.applicationId.localeCompare(right.applicationId);
    return appOrder === 0
      ? left.entry.path.localeCompare(right.entry.path)
      : appOrder;
  });
  return {
    applicationIds,
    entries: snapshotEntries,
  };
}

export async function ensureAppsRootPath(dataDir: string): Promise<string> {
  const appsRootPath = resolveAppsRootPath(dataDir);
  await fs.mkdir(appsRootPath, { recursive: true });
  return appsRootPath;
}
