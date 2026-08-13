import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath, readlink } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export class FirmwareArtifactHashError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FirmwareArtifactHashError";
  }
}

interface FileEvidence {
  device: string;
  inode: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}

interface ArtifactFile {
  relativePath: string;
  logicalPath: string;
  sourcePath: string;
  kind: "regular" | "symlink";
  evidence: FileEvidence;
  symlinkTarget: string | null;
}

export interface ForgeArtifactHash {
  artifactHash: string;
  fileCount: number;
  regularFileHashes: Readonly<Record<string, string>>;
}

function evidence(stat: BigIntStats): FileEvidence {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function pythonPathCompare(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function sameEvidence(left: FileEvidence, right: FileEvidence): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function collectArtifactFiles(root: string, signal: AbortSignal): Promise<ArtifactFile[]> {
  const files: ArtifactFile[] = [];

  const visit = async (directory: string, prefix: string): Promise<void> => {
    signal.throwIfAborted();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      signal.throwIfAborted();
      const logicalPath = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(logicalPath, { bigint: true });
      if (stat.isDirectory()) {
        await visit(logicalPath, relativePath);
        continue;
      }
      if (stat.isFile()) {
        files.push({
          relativePath,
          logicalPath,
          sourcePath: logicalPath,
          kind: "regular",
          evidence: evidence(stat),
          symlinkTarget: null,
        });
        continue;
      }
      if (!stat.isSymbolicLink()) continue;

      let target: string;
      let resolvedTarget: string;
      try {
        [target, resolvedTarget] = await Promise.all([readlink(logicalPath), realpath(logicalPath)]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new FirmwareArtifactHashError(
          "FIRMWARE_FILE_UNREADABLE",
          `Firmware symlink could not be inspected: /${relativePath}`,
          { cause: error },
        );
      }
      if (!isContained(root, resolvedTarget)) {
        throw new FirmwareArtifactHashError(
          "UNSAFE_FIRMWARE_SYMLINK",
          `Firmware symlink escapes the prepared root: /${relativePath}`,
        );
      }
      const targetStat = await lstat(resolvedTarget, { bigint: true });
      if (!targetStat.isFile()) continue;
      files.push({
        relativePath,
        logicalPath,
        sourcePath: resolvedTarget,
        kind: "symlink",
        evidence: evidence(stat),
        symlinkTarget: target,
      });
    }
  };

  await visit(root, "");
  return files.sort((left, right) => pythonPathCompare(left.relativePath, right.relativePath));
}

async function hashFile(
  root: string,
  file: ArtifactFile,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  let currentRealPath: string;
  try {
    currentRealPath = await realpath(file.logicalPath);
  } catch (error) {
    throw new FirmwareArtifactHashError(
      "FIRMWARE_CHANGED_DURING_HASH",
      `Firmware file changed while hashing: /${file.relativePath}`,
      { cause: error },
    );
  }
  if (!isContained(root, currentRealPath)) {
    throw new FirmwareArtifactHashError(
      "UNSAFE_FIRMWARE_SYMLINK",
      `Firmware path escapes the prepared root: /${file.relativePath}`,
    );
  }
  if (
    (file.kind === "regular" && currentRealPath !== file.logicalPath) ||
    (file.kind === "symlink" && currentRealPath !== file.sourcePath)
  ) {
    throw new FirmwareArtifactHashError(
      "FIRMWARE_CHANGED_DURING_HASH",
      `Firmware path changed while hashing: /${file.relativePath}`,
    );
  }

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(currentRealPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throw new FirmwareArtifactHashError(
      "FIRMWARE_FILE_UNREADABLE",
      `Firmware file could not be read: /${file.relativePath}`,
      { cause: error },
    );
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new FirmwareArtifactHashError(
        "FIRMWARE_CHANGED_DURING_HASH",
        `Firmware path stopped being a regular file: /${file.relativePath}`,
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (!sameEvidence(evidence(before), evidence(after))) {
      throw new FirmwareArtifactHashError(
        "FIRMWARE_CHANGED_DURING_HASH",
        `Firmware file changed while hashing: /${file.relativePath}`,
      );
    }
    return digest.digest("hex");
  } finally {
    await handle.close();
  }
}

function sameTree(left: readonly ArtifactFile[], right: readonly ArtifactFile[]): boolean {
  return (
    left.length === right.length &&
    left.every((file, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        file.relativePath === other.relativePath &&
        file.kind === other.kind &&
        file.sourcePath === other.sourcePath &&
        file.symlinkTarget === other.symlinkTarget &&
        sameEvidence(file.evidence, other.evidence)
      );
    })
  );
}

/**
 * Exact TypeScript port of Forge qemu_dynamic.py::_firmware_artifact_hash at
 * commit 5083a9d745e6d0e22166d2850e7e43fc3987c350, with fail-closed reads and
 * containment checks added for bench preparation.
 */
export async function computeForgeArtifactHash(
  rootfsPath: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<ForgeArtifactHash> {
  let root: string;
  try {
    root = await realpath(rootfsPath);
    if (!(await lstat(root)).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    throw new FirmwareArtifactHashError(
      "MOUNT_INCOMPLETE",
      "The prepared firmware rootfs is missing or is not a directory.",
      { cause: error },
    );
  }

  const before = await collectArtifactFiles(root, signal);
  const outer = createHash("sha256");
  const regularFileHashes: Record<string, string> = {};
  for (const file of before) {
    const fileHash = await hashFile(root, file, signal);
    outer.update(Buffer.from(file.relativePath, "utf8"));
    outer.update(Buffer.from([0]));
    outer.update(Buffer.from(fileHash, "hex"));
    if (file.kind === "regular") regularFileHashes[`/${file.relativePath}`] = fileHash;
  }

  const after = await collectArtifactFiles(root, signal);
  if (!sameTree(before, after)) {
    throw new FirmwareArtifactHashError(
      "FIRMWARE_CHANGED_DURING_HASH",
      "The firmware tree changed while its Forge artifact hash was computed.",
    );
  }

  return Object.freeze({
    artifactHash: outer.digest("hex"),
    fileCount: before.length,
    regularFileHashes: Object.freeze(regularFileHashes),
  });
}
