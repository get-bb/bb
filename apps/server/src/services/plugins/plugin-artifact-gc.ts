import { rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  deletePluginArtifact,
  deletePluginStateSnapshot,
  listExpiredPluginStateSnapshots,
  listGarbageCollectablePluginArtifacts,
  type DbConnection,
  type PluginArtifactRow,
} from "@bb/db";

export function pluginArtifactStorageRoot(
  artifact: PluginArtifactRow,
): string | null {
  if (artifact.sourceKind === "npm") {
    const marker = `${sep}node_modules${sep}`;
    const index = artifact.path.lastIndexOf(marker);
    return index === -1 ? null : artifact.path.slice(0, index);
  }
  if (artifact.gitResolvedCommit === null) return null;
  const parts = artifact.path.split(sep);
  const commitIndex = parts.lastIndexOf(artifact.gitResolvedCommit);
  if (commitIndex === -1) return null;
  // A nested plugin shares its checkout with every sibling plugin of the same
  // repository and commit, so collecting it removes its own directory only.
  // The checkout itself is left for the siblings that still build into it.
  if (commitIndex < parts.length - 1) return artifact.path;
  return parts.slice(0, commitIndex + 1).join(sep) || sep;
}

function isManagedCachePath(dataDir: string, path: string): boolean {
  const cacheRoot = resolve(dataDir, "plugins", "cache");
  const candidate = resolve(path);
  return candidate.startsWith(`${cacheRoot}${sep}`);
}

export async function garbageCollectPluginArtifacts(args: {
  db: DbConnection;
  dataDir: string;
  now: number;
  retentionMs: number;
  warn: (message: string) => void;
}): Promise<void> {
  for (const snapshot of listExpiredPluginStateSnapshots(args.db, args.now)) {
    try {
      await rm(snapshot.snapshotPath, { recursive: true, force: true });
      deletePluginStateSnapshot(args.db, snapshot.id);
    } catch (error) {
      args.warn(
        `plugin snapshot GC failed for ${snapshot.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const artifacts = listGarbageCollectablePluginArtifacts(args.db, {
    now: args.now,
    cutoff: args.now - args.retentionMs,
  });
  for (const artifact of artifacts) {
    const storageRoot = pluginArtifactStorageRoot(artifact);
    if (
      storageRoot === null ||
      !isManagedCachePath(args.dataDir, storageRoot)
    ) {
      args.warn(
        `refusing to garbage collect unmanaged plugin path for ${artifact.id}`,
      );
      continue;
    }
    try {
      await rm(storageRoot, { recursive: true, force: true });
      deletePluginArtifact(args.db, artifact.id);
      // Remove an empty npm package/version parent opportunistically. force
      // is false by default, so a sibling artifact keeps it intact.
      await rm(dirname(storageRoot)).catch(() => {});
    } catch (error) {
      args.warn(
        `plugin artifact GC failed for ${artifact.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
