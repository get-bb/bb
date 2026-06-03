import { readdir, readFile } from "node:fs/promises";
import {
  resolveApplicationDataPath,
  resolveApplicationManifestPath,
  resolveAppsRootPath,
} from "@bb/config/app-storage-paths";
import { applicationIdSchema, type ApplicationId } from "@bb/domain";
import { appManifestSchema } from "@bb/server-contract";

export interface TrackedApplicationDataTarget {
  applicationId: ApplicationId;
  appDataPath: string;
}

interface ListTrackedApplicationDataTargetsArgs {
  dataDir: string;
}

function isIgnoredApplicationStorageEntry(entryName: string): boolean {
  return (
    entryName.startsWith(".tmp-app_") || entryName.startsWith(".delete-app_")
  );
}

async function isValidApplicationManifest(
  dataDir: string,
  applicationId: ApplicationId,
): Promise<boolean> {
  try {
    const manifest = appManifestSchema.parse(
      JSON.parse(
        await readFile(
          resolveApplicationManifestPath(dataDir, applicationId),
          "utf8",
        ),
      ),
    );
    return manifest.id === applicationId;
  } catch {
    return false;
  }
}

export async function listTrackedApplicationDataTargets(
  args: ListTrackedApplicationDataTargetsArgs,
): Promise<TrackedApplicationDataTarget[]> {
  let entries;
  try {
    entries = await readdir(resolveAppsRootPath(args.dataDir), {
      withFileTypes: true,
    });
  } catch {
    return [];
  }

  const targets: TrackedApplicationDataTarget[] = [];
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
    if (!(await isValidApplicationManifest(args.dataDir, parsed.data))) {
      continue;
    }
    targets.push({
      applicationId: parsed.data,
      appDataPath: resolveApplicationDataPath(args.dataDir, parsed.data),
    });
  }
  return targets.sort((left, right) =>
    left.applicationId.localeCompare(right.applicationId),
  );
}
