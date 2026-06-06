import { mkdir, readdir, rename } from "node:fs/promises";
import type { Dirent } from "node:fs";
import {
  resolveAppDataRootPath,
  resolveApplicationDataPath,
  resolveAppsRootPath,
  resolveLegacyApplicationDataPath,
} from "@bb/config/app-storage-paths";
import { applicationIdSchema } from "@bb/domain";
import type { ServerLogger } from "../../types.js";
import { directoryExists, isFsErrorWithCode } from "../lib/fs-errors.js";

interface MigrateAppDataLayoutArgs {
  dataDir: string;
  logger: ServerLogger;
}

/**
 * One-time layout migration: moves legacy per-app `data/` directories from
 * inside each app folder to the shared app-data root. Idempotent — already
 * migrated apps have no legacy directory and are skipped. When both layouts
 * have data (a legacy dir reappeared after migration), the legacy dir is left
 * in place untouched and a warning is logged: merging would risk clobbering
 * newer data, and deleting would destroy user state.
 */
export async function migrateAppDataLayout(
  args: MigrateAppDataLayoutArgs,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(resolveAppsRootPath(args.dataDir), {
      withFileTypes: true,
    });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const parsed = applicationIdSchema.safeParse(entry.name);
    if (!parsed.success) {
      continue;
    }
    const applicationId = parsed.data;
    const legacyDataPath = resolveLegacyApplicationDataPath(
      args.dataDir,
      applicationId,
    );
    if (!(await directoryExists(legacyDataPath))) {
      continue;
    }
    const dataPath = resolveApplicationDataPath(args.dataDir, applicationId);
    if (await directoryExists(dataPath)) {
      args.logger.warn(
        { applicationId, dataPath, legacyDataPath },
        "App has data in both the legacy and current layout; leaving the legacy directory untouched",
      );
      continue;
    }
    await mkdir(resolveAppDataRootPath(args.dataDir), { recursive: true });
    await rename(legacyDataPath, dataPath);
    args.logger.info(
      { applicationId, dataPath, legacyDataPath },
      "Migrated app data out of the app folder",
    );
  }
}
