import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readlink,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommitFirmwareMountInput } from "../cache/mount-registry.js";
import type {
  FirmwareExecutionScope,
  LinkNodeResult,
} from "../cache/blob-store.js";
import {
  FirmwareCacheError,
  manifestPath,
  mountRoot,
  recoveryPath,
  rootfsPath,
  validatePvId,
} from "../cache/layout.js";
import type {
  FirmwareManifest,
  FirmwareManifestMeta,
  FirmwareMount,
  FirmwareNode,
  MountReadiness,
} from "../cache/manifest.js";
import {
  resolveSafeNodePath,
  safeSymlinkTarget,
} from "../cache/path-safety.js";
import type { FirmwareProgressPublisher } from "./progress.js";
import { publishFirmwareProgress, redactHostPaths } from "./progress.js";
import type {
  Snapshot,
  SnapshotFile,
  SnapshotUnpackMetadata,
} from "./snapshot-schema.js";

export interface UnpackCache {
  open(scope: FirmwareExecutionScope): FirmwareManifest;
  putBlob(
    scope: FirmwareExecutionScope,
    source: NodeJS.ReadableStream,
    expectedSha256: string,
  ): Promise<{ path: string; reused: boolean }>;
  linkNode(
    scope: FirmwareExecutionScope,
    mount: FirmwareMount,
    node: FirmwareNode,
    blobPath: string,
  ): Promise<LinkNodeResult>;
  commit(input: CommitFirmwareMountInput): void;
  readiness(manifest: FirmwareManifest): MountReadiness;
  verifyIntegrity(manifest: FirmwareManifest): { verifiedFiles: number };
}

export interface IngestSnapshotInput {
  scope: FirmwareExecutionScope;
  cache: UnpackCache;
  snapshot: Snapshot;
  extractedRootfs: string;
  stagedSnapshotPath: string;
  scanId: string | null;
  maxDepth: number;
  publishProgress?: FirmwareProgressPublisher;
  now: () => Date;
  promotionId?: string;
}

export interface IngestSnapshotResult {
  mount: FirmwareMount;
  snapshotPath: string;
  warnings: string[];
  reusedBlobs: number;
}

interface VerifiedNode {
  node: FirmwareNode;
  blobPath: string;
}

interface LinkedNode {
  node: FirmwareNode;
  blobPath: string;
}

function metadataErrors(
  metadata: SnapshotUnpackMetadata | undefined,
  paths: readonly string[],
): string[] {
  if (!metadata || (!metadata.errorType && !metadata.errorMsg)) return [];
  return [
    redactHostPaths(
      [metadata.errorType, metadata.errorMsg]
        .filter((value) => value !== undefined)
        .join(": "),
      paths,
    ),
  ];
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function isDirectory(entry: SnapshotFile): boolean {
  return (
    entry.mimeType === "inode/directory" ||
    entry.fullType?.toLocaleLowerCase().includes("directory") === true
  );
}

function isSymlink(entry: SnapshotFile): boolean {
  return (
    entry.mimeType === "inode/symlink" ||
    entry.fullType?.toLocaleLowerCase().includes("symbolic link") === true ||
    entry.fullType?.toLocaleLowerCase().includes("symlink") === true
  );
}

function directoryNode(path: string): FirmwareNode {
  return {
    path,
    kind: "directory",
    fileHash: null,
    size: null,
    mimeType: "inode/directory",
    fullType: null,
    unixMode: 0o755,
    symlinkTarget: null,
    materialized: false,
    errors: [],
  };
}

function parentDirectories(path: string): string[] {
  const segments = path.slice(1).split("/");
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(`/${segments.slice(0, index).join("/")}`);
  }
  return parents;
}

async function verifyAndStoreFiles(input: IngestSnapshotInput): Promise<{
  nodes: FirmwareNode[];
  verified: VerifiedNode[];
  linked: LinkedNode[];
  warnings: string[];
  reused: number;
}> {
  const directories = new Set<string>();
  const verified: VerifiedNode[] = [];
  const linked: LinkedNode[] = [];
  const warnings: string[] = [];
  let reused = 0;
  const total = input.snapshot.fileTree.length;

  for (const [index, entry] of input.snapshot.fileTree.entries()) {
    for (const parent of parentDirectories(entry.filePath))
      directories.add(parent);
    if (entry.fileHash === null) {
      if (isDirectory(entry)) {
        directories.add(entry.filePath);
      } else if (isSymlink(entry)) {
        let error: string | null = null;
        try {
          const sourcePath = await resolveSafeNodePath(
            input.extractedRootfs,
            entry.filePath,
          );
          const stat = await lstat(sourcePath);
          if (!stat.isSymbolicLink()) {
            error = `Snapshot symlink has no recoverable target: ${entry.filePath}`;
          } else {
            const target = safeSymlinkTarget(
              entry.filePath,
              await readlink(sourcePath),
            );
            linked.push({
              blobPath: "",
              node: {
                path: entry.filePath,
                kind: "symlink",
                fileHash: null,
                size: null,
                mimeType: entry.mimeType,
                fullType: entry.fullType,
                unixMode: stat.mode & 0o7777,
                symlinkTarget: target,
                materialized: false,
                errors: [],
              },
            });
          }
        } catch (caught) {
          if (
            caught instanceof FirmwareCacheError &&
            caught.code === "UNSAFE_FIRMWARE_SYMLINK"
          ) {
            error = `Unsafe snapshot symlink target: ${entry.filePath}`;
          } else if ((caught as NodeJS.ErrnoException).code === "ENOENT") {
            error = `Snapshot symlink has no recoverable target: ${entry.filePath}`;
          } else {
            throw caught;
          }
        }
        if (error !== null) {
          warnings.push(error);
          linked.push({
            blobPath: "",
            node: {
              path: entry.filePath,
              kind: "file",
              fileHash: null,
              size: null,
              mimeType: entry.mimeType,
              fullType: entry.fullType,
              unixMode: null,
              symlinkTarget: null,
              materialized: false,
              errors: [error],
            },
          });
        }
      } else {
        warnings.push(
          `Skipped snapshot node without verified bytes: ${entry.filePath}`,
        );
      }
      publishFirmwareProgress(
        input.publishProgress,
        input.scope.projectVersionId,
        "ingesting",
        index + 1,
        total,
      );
      continue;
    }

    const sourcePath = await resolveSafeNodePath(
      input.extractedRootfs,
      entry.filePath,
    );
    const stat = await lstat(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new FirmwareCacheError(
        "UNPACK_FILE_INVALID",
        `Extracted regular-file entry is not a regular file: ${entry.filePath}`,
      );
    }
    if (entry.fileSize !== null && stat.size !== entry.fileSize) {
      throw new FirmwareCacheError(
        "UNPACK_FILE_SIZE_MISMATCH",
        `Extracted file size does not match snapshot.json: ${entry.filePath}`,
      );
    }
    const blob = await input.cache.putBlob(
      input.scope,
      createReadStream(sourcePath),
      entry.fileHash,
    );
    if (blob.reused) reused += 1;
    verified.push({
      blobPath: blob.path,
      node: {
        path: entry.filePath,
        kind: "file",
        fileHash: entry.fileHash,
        size: entry.fileSize ?? stat.size,
        mimeType: entry.mimeType,
        fullType: entry.fullType,
        unixMode: stat.mode & 0o7777,
        symlinkTarget: null,
        materialized: true,
        errors: metadataErrors(input.snapshot.unpackMetadata[entry.fileHash], [
          input.scope.worktreeRoot,
          input.extractedRootfs,
        ]),
      },
    });
    publishFirmwareProgress(
      input.publishProgress,
      input.scope.projectVersionId,
      "ingesting",
      index + 1,
      total,
    );
  }

  const nodes = [
    ...[...directories]
      .sort(
        (left, right) =>
          left.split("/").length - right.split("/").length ||
          left.localeCompare(right),
      )
      .map(directoryNode),
    ...verified.map(({ node }) => node),
    ...linked.map(({ node }) => node),
  ];
  return { nodes, verified, linked, warnings, reused };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function renameIfPresent(
  source: string,
  destination: string,
): Promise<boolean> {
  if (!(await pathExists(source))) return false;
  await rename(source, destination);
  return true;
}

async function removeManifestFiles(path: string): Promise<void> {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-wal`, { force: true }),
    rm(`${path}-shm`, { force: true }),
  ]);
}

async function pruneRecoveryGenerations(
  parent: string,
  keep: number,
): Promise<void> {
  const entries = await readdir(parent, { withFileTypes: true });
  const generations = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const path = join(parent, entry.name);
        return { path, mtimeMs: (await lstat(path)).mtimeMs };
      }),
  );
  generations.sort((left, right) => right.mtimeMs - left.mtimeMs);
  await Promise.all(
    generations
      .slice(keep)
      .map((generation) =>
        rm(generation.path, { recursive: true, force: true }),
      ),
  );
}

function sanitizedMetadata(
  metadata: Readonly<Record<string, SnapshotUnpackMetadata>>,
  paths: readonly string[],
): Record<string, SnapshotUnpackMetadata> {
  return Object.fromEntries(
    Object.entries(metadata).map(([hash, item]) => [
      hash,
      {
        ...item,
        tried: item.tried.map((value) => redactHostPaths(value, paths)),
        ...(item.triedVersion === undefined
          ? {}
          : { triedVersion: redactHostPaths(item.triedVersion, paths) }),
        ...(item.used === undefined
          ? {}
          : { used: redactHostPaths(item.used, paths) }),
        ...(item.usedVersion === undefined
          ? {}
          : { usedVersion: redactHostPaths(item.usedVersion, paths) }),
        ...(item.errorType === undefined
          ? {}
          : { errorType: redactHostPaths(item.errorType, paths) }),
        ...(item.errorMsg === undefined
          ? {}
          : { errorMsg: redactHostPaths(item.errorMsg, paths) }),
      },
    ]),
  );
}

function predictedReadiness(
  fullyMaterialized: boolean,
  hydratedCount: number,
): MountReadiness {
  if (fullyMaterialized) return "fully_materialized";
  return hydratedCount === 0 ? "metadata_only" : "partial";
}

export async function ingestSnapshotGeneration(
  input: IngestSnapshotInput,
): Promise<IngestSnapshotResult> {
  const prepared = await verifyAndStoreFiles(input);
  const pvId = input.scope.projectVersionId;
  const finalRootfs = rootfsPath(input.scope.worktreeRoot, pvId);
  const finalManifest = manifestPath(input.scope.worktreeRoot, pvId);
  const finalSnapshot = join(dirname(finalManifest), "snapshot.json");
  const stagingId = validatePvId(input.promotionId ?? randomUUID());
  const stagingPvId = validatePvId(`wp48-${stagingId}`);
  const stagingScope: FirmwareExecutionScope = {
    ...input.scope,
    projectVersionId: stagingPvId,
  };
  const transientMount = mountRoot(input.scope.worktreeRoot, stagingPvId);
  const preparedRootfs = join(
    dirname(input.stagedSnapshotPath),
    "prepared-rootfs",
  );
  const preparedManifest = join(
    dirname(input.stagedSnapshotPath),
    "prepared-manifest.sqlite",
  );
  const backupRoot = join(
    recoveryPath(input.scope.worktreeRoot, pvId),
    `promotion-${stagingId}`,
  );
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });

  const backupRootfs = join(backupRoot, "rootfs");
  const backupManifest = join(backupRoot, "manifest.sqlite");
  const backupManifestWal = `${backupManifest}-wal`;
  const backupManifestShm = `${backupManifest}-shm`;
  const backupSnapshot = join(backupRoot, "snapshot.json");
  let backedUpRootfs = false;
  let backedUpManifest = false;
  let backedUpManifestWal = false;
  let backedUpManifestShm = false;
  let backedUpSnapshot = false;
  let promotedRootfs = false;
  let promotedManifest = false;
  let promotedSnapshot = false;
  let manifest: FirmwareManifest | null = null;

  try {
    try {
      await mkdir(transientMount, { mode: 0o700 });
    } catch (error) {
      throw new FirmwareCacheError(
        "UNPACK_STAGING_COLLISION",
        "The prepared firmware generation already exists.",
        { cause: error },
      );
    }
    await mkdir(rootfsPath(input.scope.worktreeRoot, stagingPvId), {
      mode: 0o700,
    });
    manifest = input.cache.open(stagingScope);
    if (manifest.invalidReason) {
      throw new FirmwareCacheError("MOUNT_INVALID", manifest.invalidReason);
    }
    const provenancePaths = [input.scope.worktreeRoot, input.extractedRootfs];
    const globalErrors = input.snapshot.errors.map((error) =>
      redactHostPaths(errorText(error), provenancePaths),
    );
    const unpackMetadata = sanitizedMetadata(
      input.snapshot.unpackMetadata,
      provenancePaths,
    );
    const nodeErrors = prepared.nodes.some((node) => node.errors.length > 0);
    const fullyMaterialized =
      prepared.warnings.length === 0 &&
      globalErrors.length === 0 &&
      !nodeErrors;
    const meta: FirmwareManifestMeta = {
      pvId,
      scanId: input.scanId,
      inputSha256: input.snapshot.inputSha256,
      source: "standalone_unpack",
      artifactHash: null,
      fullyMaterialized,
      materializedAt: input.now().toISOString(),
      nodeCount: prepared.nodes.length,
      hydratedCount: prepared.verified.length,
      adminBytesOk: true,
      unpackErrors: [...globalErrors, ...prepared.warnings],
      stale: false,
    };
    manifest.replaceNodes(prepared.nodes, meta);
    manifest.database
      .prepare(
        "INSERT INTO fs_meta(key, value) VALUES ('unpack_metadata', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(unpackMetadata));
    manifest.database
      .prepare(
        "INSERT INTO fs_meta(key, value) VALUES ('unpack_max_depth', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(input.maxDepth));

    const mount: FirmwareMount = {
      pvId: stagingPvId,
      source: "standalone_unpack",
      rootfsPath: rootfsPath(input.scope.worktreeRoot, stagingPvId),
      manifestPath: manifest.path,
      inputSha256: input.snapshot.inputSha256,
      artifactHash: null,
      readiness: predictedReadiness(
        fullyMaterialized,
        prepared.verified.length,
      ),
      nodeCount: prepared.nodes.length,
      hydratedCount: prepared.verified.length,
      errors: [],
    };
    for (const node of prepared.nodes.filter(
      (item) => item.kind === "directory",
    )) {
      await input.cache.linkNode(stagingScope, mount, node, "");
    }
    for (const item of prepared.verified) {
      await input.cache.linkNode(stagingScope, mount, item.node, item.blobPath);
    }
    for (const item of prepared.linked.filter(
      ({ node }) => node.kind === "symlink",
    )) {
      await input.cache.linkNode(stagingScope, mount, item.node, item.blobPath);
    }
    manifest.close();
    manifest = null;
    await rename(
      rootfsPath(input.scope.worktreeRoot, stagingPvId),
      preparedRootfs,
    );
    await rename(
      manifestPath(input.scope.worktreeRoot, stagingPvId),
      preparedManifest,
    );
    await rm(transientMount, { recursive: true, force: true });

    backedUpRootfs = await renameIfPresent(finalRootfs, backupRootfs);
    backedUpManifest = await renameIfPresent(finalManifest, backupManifest);
    backedUpManifestWal = await renameIfPresent(
      `${finalManifest}-wal`,
      backupManifestWal,
    );
    backedUpManifestShm = await renameIfPresent(
      `${finalManifest}-shm`,
      backupManifestShm,
    );
    backedUpSnapshot = await renameIfPresent(finalSnapshot, backupSnapshot);
    await rename(preparedRootfs, finalRootfs);
    promotedRootfs = true;
    await rename(preparedManifest, finalManifest);
    promotedManifest = true;
    await rename(input.stagedSnapshotPath, finalSnapshot);
    promotedSnapshot = true;

    manifest = input.cache.open(input.scope);
    if (manifest.invalidReason) {
      throw new FirmwareCacheError("MOUNT_INVALID", manifest.invalidReason);
    }
    const promotedMount: FirmwareMount = {
      ...mount,
      pvId,
      rootfsPath: finalRootfs,
      manifestPath: finalManifest,
    };
    input.cache.commit({
      scope: {
        projectId: input.scope.projectId,
        projectVersionId: pvId,
        generationId: input.scope.generationId,
      },
      manifest,
      mount: promotedMount,
      scanId: input.scanId,
      adminBytesOk: true,
      pulledAt: input.now().toISOString(),
    });
    manifest.close();
    manifest = null;
    if (
      backedUpRootfs ||
      backedUpManifest ||
      backedUpManifestWal ||
      backedUpManifestShm ||
      backedUpSnapshot
    ) {
      await pruneRecoveryGenerations(dirname(backupRoot), 2).catch(
        () => undefined,
      );
    } else {
      await rm(backupRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    return {
      mount: promotedMount,
      snapshotPath: finalSnapshot,
      warnings: prepared.warnings,
      reusedBlobs: prepared.reused,
    };
  } catch (error) {
    manifest?.close();
    await rm(transientMount, { recursive: true, force: true });
    if (promotedRootfs) await rm(finalRootfs, { recursive: true, force: true });
    if (promotedManifest) await removeManifestFiles(finalManifest);
    if (promotedSnapshot) await rm(finalSnapshot, { force: true });
    if (backedUpRootfs) await rename(backupRootfs, finalRootfs);
    if (backedUpManifest) await rename(backupManifest, finalManifest);
    if (backedUpManifestWal)
      await rename(backupManifestWal, `${finalManifest}-wal`);
    if (backedUpManifestShm)
      await rename(backupManifestShm, `${finalManifest}-shm`);
    if (backedUpSnapshot) await rename(backupSnapshot, finalSnapshot);
    throw error;
  }
}
