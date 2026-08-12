import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  symlink,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FirmwareMount, FirmwareNode } from "./manifest.js";
import {
  assertFirmwareCacheIgnored,
  blobPath,
  FirmwareCacheError,
  globalBlobsPath,
  manifestPath,
  rootfsPath,
  stagingPath,
  validateSha256,
} from "./layout.js";
import { resolveSafeNodePath, safeSymlinkTarget } from "./path-safety.js";

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(
    createReadStream(path),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback();
      },
    }),
  );
  return hash.digest("hex");
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function existingBlobIsValid(path: string, expectedSha256: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isFile() && !stat.isSymbolicLink() && (await hashFile(path)) === expectedSha256;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function putBlob(
  worktreeRoot: string,
  source: NodeJS.ReadableStream,
  expectedSha256: string,
): Promise<{ path: string; reused: boolean }> {
  const root = assertFirmwareCacheIgnored(worktreeRoot);
  const digest = validateSha256(expectedSha256);
  const destination = blobPath(root, digest);
  if (await existingBlobIsValid(destination, digest)) return { path: destination, reused: true };
  try {
    await lstat(destination);
    throw new FirmwareCacheError(
      "BLOB_CORRUPT",
      "The canonical blob path exists but does not contain the expected bytes.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const blobDirectory = globalBlobsPath(root);
  const stageDirectory = `${stagingPath(root)}/blobs`;
  await mkdir(blobDirectory, { recursive: true, mode: 0o700 });
  await mkdir(stageDirectory, { recursive: true, mode: 0o700 });
  const stage = `${stageDirectory}/${randomUUID()}.partial`;
  const hash = createHash("sha256");

  try {
    await pipeline(
      source,
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(stage, { flags: "wx", mode: 0o600 }),
    );
    const actual = hash.digest("hex");
    if (actual !== digest) {
      throw new FirmwareCacheError(
        "BLOB_HASH_MISMATCH",
        `Blob digest mismatch: expected ${digest}, received ${actual}.`,
      );
    }
    const handle = await open(stage, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(stage, 0o444);
    try {
      await link(stage, destination);
      await fsyncDirectory(blobDirectory);
      return { path: destination, reused: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await existingBlobIsValid(destination, digest))) {
        throw new FirmwareCacheError(
          "BLOB_CORRUPT",
          "A concurrent blob promotion exposed invalid bytes.",
          { cause: error },
        );
      }
      return { path: destination, reused: true };
    }
  } finally {
    await unlink(stage).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export type LinkNodeResult =
  | { method: "hardlink"; deduplicated: true }
  | { method: "verified_copy"; deduplicated: false }
  | { method: "not_applicable"; deduplicated: false };

export interface FirmwareExecutionScope {
  worktreeRoot: string;
  projectId: string;
  projectVersionId: string;
  generationId: string;
}

async function removeIdenticalDestination(destination: string, blob: string): Promise<boolean> {
  try {
    const destinationStat = await lstat(destination);
    const blobStat = await lstat(blob);
    if (
      destinationStat.isFile() &&
      !destinationStat.isSymbolicLink() &&
      destinationStat.dev === blobStat.dev &&
      destinationStat.ino === blobStat.ino
    ) {
      return true;
    }
    throw new FirmwareCacheError(
      "FIRMWARE_NODE_EXISTS",
      "Refusing to replace an existing firmware node during materialization.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function linkNodeWithResult(
  scope: FirmwareExecutionScope,
  mount: FirmwareMount,
  node: FirmwareNode,
  blob: string,
): Promise<LinkNodeResult> {
  const worktreeRoot = assertFirmwareCacheIgnored(scope.worktreeRoot);
  if (!scope.projectId || !scope.generationId) {
    throw new FirmwareCacheError(
      "INVALID_MOUNT_SCOPE",
      "Materialization requires explicit project and generation scope.",
    );
  }
  if (mount.readiness === "invalid") {
    throw new FirmwareCacheError("MOUNT_INVALID", "Cannot link content into an invalid mount.");
  }
  if (mount.pvId !== scope.projectVersionId) {
    throw new FirmwareCacheError("MOUNT_INVALID", "The execution scope does not match the mount id.");
  }
  const expectedRootfs = rootfsPath(worktreeRoot, scope.projectVersionId);
  const expectedManifest = manifestPath(worktreeRoot, scope.projectVersionId);
  if (resolve(mount.manifestPath) !== expectedManifest) {
    throw new FirmwareCacheError("MOUNT_INVALID", "The manifest path is outside the scoped firmware mount.");
  }
  const rootStat = await lstat(mount.rootfsPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new FirmwareCacheError("MOUNT_INVALID", "The firmware rootfs is not a real directory.");
  }
  if ((await realpath(mount.rootfsPath)) !== (await realpath(expectedRootfs))) {
    throw new FirmwareCacheError("MOUNT_INVALID", "The rootfs path is outside the scoped firmware mount.");
  }
  const destination = await resolveSafeNodePath(mount.rootfsPath, node.path, true);

  if (node.kind === "directory") {
    try {
      await mkdir(destination, { mode: node.unixMode === null ? 0o755 : node.unixMode & 0o777 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await lstat(destination);
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw error;
    }
    return { method: "not_applicable", deduplicated: false };
  }
  if (node.kind === "symlink") {
    if (node.symlinkTarget === null) {
      throw new FirmwareCacheError("INVALID_MANIFEST_NODE", "Symlink node is missing its target.");
    }
    const safeTarget = safeSymlinkTarget(node.path, node.symlinkTarget);
    try {
      await symlink(safeTarget, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await readlink(destination)) !== safeTarget) throw error;
    }
    return { method: "not_applicable", deduplicated: false };
  }
  if (!node.materialized || !node.fileHash) {
    throw new FirmwareCacheError(
      "FIRMWARE_BYTES_UNVERIFIED",
      "A regular file is linked only after its bytes and digest are verified.",
    );
  }
  const blobStat = await lstat(blob);
  if (!blobStat.isFile() || blobStat.isSymbolicLink()) {
    throw new FirmwareCacheError("BLOB_CORRUPT", "The canonical blob is not a regular file.");
  }
  if (node.size !== null && blobStat.size !== node.size) {
    throw new FirmwareCacheError("BLOB_SIZE_MISMATCH", "Blob size does not match the manifest node.");
  }
  const expectedBlob = blobPath(worktreeRoot, node.fileHash);
  if ((await realpath(blob)) !== expectedBlob) {
    throw new FirmwareCacheError("BLOB_PATH_INVALID", "The blob is outside the canonical workspace store.");
  }
  if ((await hashFile(blob)) !== node.fileHash) {
    throw new FirmwareCacheError("BLOB_HASH_MISMATCH", "Blob bytes do not match the manifest node.");
  }
  if (await removeIdenticalDestination(destination, blob)) {
    return { method: "hardlink", deduplicated: true };
  }

  try {
    await link(blob, destination);
    return { method: "hardlink", deduplicated: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EPERM" && code !== "ENOTSUP" && code !== "EOPNOTSUPP") {
      throw error;
    }
  }

  const temporary = `${dirname(destination)}/.${randomUUID()}.copying`;
  try {
    await copyFile(blob, temporary, constants.COPYFILE_EXCL);
    if ((await hashFile(temporary)) !== node.fileHash) {
      throw new FirmwareCacheError("BLOB_HASH_MISMATCH", "Fallback copy failed verification.");
    }
    const handle = await open(temporary, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EOPNOTSUPP") throw error;
      await copyFile(temporary, destination, constants.COPYFILE_EXCL);
      if ((await hashFile(destination)) !== node.fileHash) {
        await unlink(destination);
        throw new FirmwareCacheError("BLOB_HASH_MISMATCH", "Promoted fallback copy failed verification.");
      }
      const destinationHandle = await open(destination, "r");
      try {
        await destinationHandle.sync();
      } finally {
        await destinationHandle.close();
      }
    }
    await fsyncDirectory(dirname(destination));
    if (node.unixMode !== null) await chmod(destination, node.unixMode & 0o777);
    return { method: "verified_copy", deduplicated: false };
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function linkNode(
  scope: FirmwareExecutionScope,
  mount: FirmwareMount,
  node: FirmwareNode,
  blob: string,
): Promise<LinkNodeResult> {
  return linkNodeWithResult(scope, mount, node, blob);
}
