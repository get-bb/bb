import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  deletePluginArtifact,
  deletePluginStateSnapshot,
  listExpiredPluginStateSnapshots,
  listGarbageCollectablePluginArtifacts,
  listInstalledPluginIdsOverlappingPath,
  listPluginArtifactsAtOrUnderPath,
  listPluginArtifactsInGitCheckout,
  listPluginArtifactsUnderPath,
  type DbConnection,
  type PluginArtifactRow,
} from "@bb/db";
import type {
  PluginCachePruneEntry,
  PluginCachePruneResponse,
} from "@bb/server-contract";

const GIT_CHECKOUT_DIR_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GIT_TEMPORARY_DIR_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})\./;
const NPM_TEMPORARY_DIR_PATTERN = /\.(?:staging|promoting|corrupt)$/;

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
  return artifact.path;
}

function pluginArtifactGitCheckoutRoot(
  artifact: PluginArtifactRow,
): string | null {
  if (artifact.sourceKind !== "git") return null;
  return artifact.gitCheckoutRoot;
}

function pluginCacheRoot(dataDir: string): string {
  return resolve(dataDir, "plugins", "cache");
}

function isManagedCachePath(dataDir: string, path: string): boolean {
  return resolve(path).startsWith(`${pluginCacheRoot(dataDir)}${sep}`);
}

function isInside(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return (
    fromParent === "" ||
    (fromParent !== ".." && !fromParent.startsWith(`..${sep}`))
  );
}

function pathsOverlap(left: string, right: string): boolean {
  return isInside(left, right) || isInside(right, left);
}

interface PlannedArtifactRemoval {
  artifact: PluginArtifactRow;
  removedRoot: string;
}

function planArtifactRemovals(args: {
  db: DbConnection;
  dataDir: string;
  artifacts: PluginArtifactRow[];
  warn: (message: string) => void;
}): PlannedArtifactRemoval[] {
  const collectableIds = new Set(args.artifacts.map((artifact) => artifact.id));
  const plannedIds = new Set<string>();
  const removals: PlannedArtifactRemoval[] = [];
  for (const artifact of args.artifacts) {
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
      checkoutTenants?.some(
        (tenant) => tenant.id !== artifact.id && !plannedIds.has(tenant.id),
      ) ?? false;
    const removedRoot =
      checkoutRoot !== null && !checkoutHasAnotherTenant
        ? checkoutRoot
        : storageRoot;
    if (
      listInstalledPluginIdsOverlappingPath(args.db, removedRoot, sep).length >
      0
    ) {
      continue;
    }
    plannedIds.add(artifact.id);
    removals.push({ artifact, removedRoot });
  }
  return removals;
}

async function removeEmptyParents(
  directory: string,
  stopAt: string,
): Promise<void> {
  let current = directory;
  while (current !== stopAt && isInside(stopAt, current)) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

async function removeCacheDirectory(
  dataDir: string,
  path: string,
): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await removeEmptyParents(dirname(path), pluginCacheRoot(dataDir));
}

async function executeArtifactRemovals(args: {
  db: DbConnection;
  dataDir: string;
  removals: PlannedArtifactRemoval[];
  warn: (message: string) => void;
}): Promise<Set<string>> {
  const removedIds = new Set<string>();
  for (const { artifact, removedRoot } of args.removals) {
    try {
      await removeCacheDirectory(args.dataDir, removedRoot);
      deletePluginArtifact(args.db, artifact.id);
      removedIds.add(artifact.id);
    } catch (error) {
      args.warn(
        `plugin artifact GC failed for ${artifact.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return removedIds;
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
    retention: { now: args.now, cutoff: args.now - args.retentionMs },
    pluginId: null,
  });
  await executeArtifactRemovals({
    ...args,
    removals: planArtifactRemovals({ ...args, artifacts }),
  });
}

export async function removeUnusedPluginArtifacts(args: {
  db: DbConnection;
  dataDir: string;
  pluginId: string;
  warn: (message: string) => void;
}): Promise<void> {
  const artifacts = listGarbageCollectablePluginArtifacts(args.db, {
    retention: null,
    pluginId: args.pluginId,
  });
  await executeArtifactRemovals({
    ...args,
    removals: planArtifactRemovals({ ...args, artifacts }),
  });
}

async function diskUsageBytes(path: string): Promise<number> {
  const stats = await lstat(path).catch(() => null);
  if (stats === null) return 0;
  const own = stats.blocks > 0 ? stats.blocks * 512 : stats.size;
  if (!stats.isDirectory()) return own;
  const children = await readdir(path).catch(() => []);
  const sizes = await Promise.all(
    children.map((child) => diskUsageBytes(join(path, child))),
  );
  return sizes.reduce((total, size) => total + size, own);
}

async function childDirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function listGitCacheEntries(directory: string): Promise<string[]> {
  const entries: string[] = [];
  for (const name of await childDirectories(directory)) {
    const path = join(directory, name);
    if (GIT_CHECKOUT_DIR_PATTERN.test(name)) entries.push(path);
    else if (!GIT_TEMPORARY_DIR_PATTERN.test(name)) {
      entries.push(...(await listGitCacheEntries(path)));
    }
  }
  return entries;
}

async function listNpmCacheEntries(npmRoot: string): Promise<string[]> {
  const packageDirs: string[] = [];
  for (const name of await childDirectories(npmRoot)) {
    if (!name.startsWith("@")) {
      packageDirs.push(join(npmRoot, name));
      continue;
    }
    for (const scoped of await childDirectories(join(npmRoot, name))) {
      packageDirs.push(join(npmRoot, name, scoped));
    }
  }
  const entries: string[] = [];
  for (const packageDir of packageDirs) {
    for (const version of await childDirectories(packageDir)) {
      if (!NPM_TEMPORARY_DIR_PATTERN.test(version)) {
        entries.push(join(packageDir, version));
      }
    }
  }
  return entries;
}

export async function prunePluginCache(args: {
  db: DbConnection;
  dataDir: string;
  dryRun: boolean;
  warn: (message: string) => void;
}): Promise<PluginCachePruneResponse> {
  const cacheRoot = pluginCacheRoot(args.dataDir);
  const artifacts = listGarbageCollectablePluginArtifacts(args.db, {
    retention: null,
    pluginId: null,
  });
  const removals = planArtifactRemovals({ ...args, artifacts });
  const plannedIds = new Set(removals.map(({ artifact }) => artifact.id));
  const orphans: string[] = [];
  for (const entry of [
    ...(await listGitCacheEntries(join(cacheRoot, "git"))),
    ...(await listNpmCacheEntries(join(cacheRoot, "npm"))),
  ]) {
    if (removals.some(({ removedRoot }) => isInside(removedRoot, entry))) {
      continue;
    }
    const owned = listPluginArtifactsAtOrUnderPath(args.db, entry, sep).some(
      (artifact) => !plannedIds.has(artifact.id),
    );
    if (owned) continue;
    if (listInstalledPluginIdsOverlappingPath(args.db, entry, sep).length > 0) {
      continue;
    }
    orphans.push(entry);
  }
  const planned: Array<{
    entry: PluginCachePruneEntry;
    artifactId: string | null;
  }> = [];
  const measure = async (path: string): Promise<number> => {
    if (planned.some(({ entry }) => isInside(entry.path, path))) return 0;
    const nestedBytes = planned
      .filter(({ entry }) => isInside(path, entry.path))
      .reduce((total, { entry }) => total + entry.bytes, 0);
    return Math.max(0, (await diskUsageBytes(path)) - nestedBytes);
  };
  for (const { artifact, removedRoot } of removals) {
    planned.push({
      artifactId: artifact.id,
      entry: {
        pluginId: artifact.pluginId,
        version:
          artifact.gitResolvedCommit ??
          artifact.npmResolvedVersion ??
          "unknown",
        path: removedRoot,
        bytes: await measure(removedRoot),
      },
    });
  }
  for (const orphan of orphans) {
    planned.push({
      artifactId: null,
      entry: {
        pluginId: null,
        version: basename(orphan),
        path: orphan,
        bytes: await measure(orphan),
      },
    });
  }
  let removed = planned;
  if (!args.dryRun) {
    const removedIds = await executeArtifactRemovals({ ...args, removals });
    const failedOrphans = new Set<string>();
    for (const orphan of orphans) {
      try {
        await removeCacheDirectory(args.dataDir, orphan);
      } catch (error) {
        failedOrphans.add(orphan);
        args.warn(
          `plugin cache prune failed for ${orphan}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    removed = planned.filter(({ entry, artifactId }) =>
      artifactId === null
        ? !failedOrphans.has(entry.path)
        : removedIds.has(artifactId),
    );
  }
  return {
    dryRun: args.dryRun,
    removed: removed.map(({ entry }) => entry),
    bytes: removed.reduce((total, { entry }) => total + entry.bytes, 0),
  };
}
