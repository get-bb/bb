import { rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  deletePluginArtifact,
  deletePluginStateSnapshot,
  listExpiredPluginStateSnapshots,
  listGarbageCollectablePluginArtifacts,
  listPluginArtifactsInGitCheckout,
  listPluginArtifactsUnderPath,
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
  const checkoutRoot = pluginArtifactGitCheckoutRoot(artifact);
  if (checkoutRoot === null) return null;
  return artifact.path === checkoutRoot ? checkoutRoot : artifact.path;
}

/**
 * The recorded checkout root. Path parsing cannot replace it: a nested
 * directory can carry the same name as the commit, and the derived root would
 * then exclude the tenants that keep the tree alive.
 */
function pluginArtifactGitCheckoutRoot(
  artifact: PluginArtifactRow,
): string | null {
  if (artifact.sourceKind !== "git") return null;
  return artifact.gitCheckoutRoot;
}

function isManagedCachePath(dataDir: string, path: string): boolean {
  const cacheRoot = resolve(dataDir, "plugins", "cache");
  const candidate = resolve(path);
  return candidate.startsWith(`${cacheRoot}${sep}`);
}

function pathsOverlap(left: string, right: string): boolean {
  const fromLeft = relative(left, right);
  const fromRight = relative(right, left);
  return (
    fromLeft === "" ||
    (fromLeft !== ".." && !fromLeft.startsWith(`..${sep}`)) ||
    (fromRight !== ".." && !fromRight.startsWith(`..${sep}`))
  );
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
  const collectableIds = new Set(artifacts.map((artifact) => artifact.id));
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
    // A checkout that a repository and commit share can hold the plugin root
    // of another plugin. Deleting it would take that plugin's files with it,
    // so this artifact waits for the pass that runs after its last tenant is
    // collected.
    const checkoutRoot = pluginArtifactGitCheckoutRoot(artifact);
    const checkoutTenants =
      checkoutRoot === null
        ? null
        : listPluginArtifactsInGitCheckout(args.db, checkoutRoot);
    const overlappingTenants =
      checkoutTenants ??
      listPluginArtifactsUnderPath(args.db, storageRoot, sep);
    if (
      overlappingTenants.some(
        (tenant) =>
          tenant.id !== artifact.id &&
          !collectableIds.has(tenant.id) &&
          pathsOverlap(storageRoot, tenant.path),
      )
    ) {
      continue;
    }
    const checkoutHasAnotherTenant =
      checkoutTenants?.some((tenant) => tenant.id !== artifact.id) ?? false;
    try {
      await rm(storageRoot, { recursive: true, force: true });
      if (
        checkoutRoot !== null &&
        checkoutRoot !== storageRoot &&
        !checkoutHasAnotherTenant
      ) {
        await rm(checkoutRoot, { recursive: true, force: true });
      }
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
