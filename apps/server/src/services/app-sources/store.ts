import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  resolveAppSourcesConfigPath,
  resolveAppSourcesRootPath,
  resolveAppSourceStatePath,
} from "@bb/config/app-storage-paths";
import type { AppSourceName } from "@bb/domain";
import {
  appSourceConfigSchema,
  appSourceSyncStateSchema,
  type AppSourceConfig,
  type AppSourceSyncState,
} from "@bb/server-contract";
import { isFsErrorWithCode } from "../lib/fs-errors.js";

const appSourceConfigListSchema = appSourceConfigSchema.array();

export const EMPTY_APP_SOURCE_SYNC_STATE: AppSourceSyncState = {
  lastSyncStartedAt: null,
  lastSyncedAt: null,
  lastCommitSha: null,
  lastError: null,
  apps: [],
};

async function readJsonFileOrNull(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.tmp-${path.basename(filePath)}-${randomUUID().slice(0, 8)}`,
  );
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function readAppSourceConfigs(
  dataDir: string,
): Promise<AppSourceConfig[]> {
  const raw = await readJsonFileOrNull(resolveAppSourcesConfigPath(dataDir));
  if (raw === null) {
    return [];
  }
  return appSourceConfigListSchema.parse(raw);
}

export async function writeAppSourceConfigs(
  dataDir: string,
  configs: AppSourceConfig[],
): Promise<void> {
  await mkdir(resolveAppSourcesRootPath(dataDir), { recursive: true });
  await writeJsonFileAtomically(
    resolveAppSourcesConfigPath(dataDir),
    appSourceConfigListSchema.parse(configs),
  );
}

/** Unreadable or invalid state degrades to the empty state: the next sync rebuilds it. */
export async function readAppSourceSyncState(
  dataDir: string,
  sourceName: AppSourceName,
): Promise<AppSourceSyncState> {
  let raw: unknown;
  try {
    raw = await readJsonFileOrNull(
      resolveAppSourceStatePath(dataDir, sourceName),
    );
  } catch {
    return EMPTY_APP_SOURCE_SYNC_STATE;
  }
  if (raw === null) {
    return EMPTY_APP_SOURCE_SYNC_STATE;
  }
  const parsed = appSourceSyncStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_APP_SOURCE_SYNC_STATE;
}

export async function writeAppSourceSyncState(
  dataDir: string,
  sourceName: AppSourceName,
  state: AppSourceSyncState,
): Promise<void> {
  await writeJsonFileAtomically(
    resolveAppSourceStatePath(dataDir, sourceName),
    appSourceSyncStateSchema.parse(state),
  );
}
