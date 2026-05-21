import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { HostReadFileRelativeDotfilePolicy } from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
} from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";

interface ValidateRootRelativeWritePathArgs {
  dotfiles: HostReadFileRelativeDotfilePolicy;
  relativePath: string;
}

interface ValidatedRootRelativeWritePath {
  resultPath: string;
  segments: readonly string[];
}

interface ExistingFileSnapshot {
  hash: string;
  modifiedAtMs: number;
  sizeBytes: number;
}

interface ResolveWritableTargetArgs {
  relativePath: ValidatedRootRelativeWritePath;
  rootPath: string;
}

interface ResolvedWritableTarget {
  absolutePath: string;
  parentPath: string;
  resultPath: string;
  rootPath: string;
}

interface ReadExistingSnapshotArgs {
  targetPath: string;
}

interface WriteRootRelativeFileArgs {
  content: string;
  contentEncoding: "base64" | "utf8";
  dotfiles: HostReadFileRelativeDotfilePolicy;
  relativePath: string;
  rootPath: string;
}

interface WriteRootRelativeFileResult {
  hash: string;
  modifiedAtMs: number;
  path: string;
  sizeBytes: number;
}

interface DeleteRootRelativeFileArgs {
  dotfiles: HostReadFileRelativeDotfilePolicy;
  relativePath: string;
  rootPath: string;
}

interface DeleteRootRelativeFileResult {
  deleted: boolean;
  path: string;
  previousHash: string | null;
}

function validateRootRelativeWritePath(
  args: ValidateRootRelativeWritePathArgs,
): ValidatedRootRelativeWritePath {
  if (
    args.relativePath.includes("\0") ||
    args.relativePath.includes("\\") ||
    path.posix.isAbsolute(args.relativePath)
  ) {
    throw new CommandDispatchError("invalid_path", "Path must be relative");
  }

  const segments = args.relativePath.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new CommandDispatchError("invalid_path", "Path must be relative");
  }

  if (
    args.dotfiles === "deny" &&
    segments.some((segment) => segment.startsWith("."))
  ) {
    throw new ExpectedCommandDispatchError(
      "ENOENT",
      `Path does not exist: ${args.relativePath}`,
    );
  }

  return {
    resultPath: segments.join("/"),
    segments,
  };
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeWriteContent(
  content: string,
  contentEncoding: "base64" | "utf8",
): Buffer {
  return Buffer.from(content, contentEncoding === "utf8" ? "utf8" : "base64");
}

async function ensureWritableRoot(rootPath: string): Promise<string> {
  if (!path.isAbsolute(rootPath)) {
    throw new CommandDispatchError("invalid_path", "rootPath must be absolute");
  }

  await fs.mkdir(rootPath, { recursive: true });
  return resolveNonSymlinkDirectoryPath({
    description: "Root path",
    path: rootPath,
  });
}

async function resolveWritableTarget(
  args: ResolveWritableTargetArgs,
): Promise<ResolvedWritableTarget> {
  const realRootPath = await ensureWritableRoot(args.rootPath);
  const absolutePath = path.join(realRootPath, ...args.relativePath.segments);
  const parentPath = path.dirname(absolutePath);
  await fs.mkdir(parentPath, { recursive: true });
  const realParentPath = await resolveNonSymlinkDirectoryPath({
    description: "Parent path",
    path: parentPath,
  });
  if (!isPathWithinRoot(realParentPath, realRootPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      `Path "${args.relativePath.resultPath}" escapes write root`,
    );
  }
  return {
    absolutePath: path.join(realParentPath, path.basename(absolutePath)),
    parentPath: realParentPath,
    resultPath: args.relativePath.resultPath,
    rootPath: realRootPath,
  };
}

async function readExistingSnapshot(
  args: ReadExistingSnapshotArgs,
): Promise<ExistingFileSnapshot | null> {
  let stat;
  try {
    stat = await fs.lstat(args.targetPath);
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new CommandDispatchError(
      "invalid_path",
      "Path is a symlink, not a file",
    );
  }
  if (stat.isDirectory()) {
    throw new CommandDispatchError(
      "invalid_path",
      "Path is a directory, not a file",
    );
  }

  const bytes = await fs.readFile(args.targetPath);
  return {
    hash: sha256(bytes),
    modifiedAtMs: stat.mtimeMs,
    sizeBytes: stat.size,
  };
}

export async function writeRootRelativeFile(
  args: WriteRootRelativeFileArgs,
): Promise<WriteRootRelativeFileResult> {
  const relativePath = validateRootRelativeWritePath({
    relativePath: args.relativePath,
    dotfiles: args.dotfiles,
  });
  const target = await resolveWritableTarget({
    rootPath: args.rootPath,
    relativePath,
  });
  await readExistingSnapshot({
    targetPath: target.absolutePath,
  });

  const bytes = decodeWriteContent(args.content, args.contentEncoding);
  const tempPath = path.join(
    target.parentPath,
    `.${path.basename(target.absolutePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await fs.writeFile(tempPath, bytes);
  try {
    await fs.rename(tempPath, target.absolutePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  const stat = await fs.stat(target.absolutePath);
  return {
    path: target.resultPath,
    hash: sha256(bytes),
    modifiedAtMs: stat.mtimeMs,
    sizeBytes: stat.size,
  };
}

export async function deleteRootRelativeFile(
  args: DeleteRootRelativeFileArgs,
): Promise<DeleteRootRelativeFileResult> {
  const relativePath = validateRootRelativeWritePath({
    relativePath: args.relativePath,
    dotfiles: args.dotfiles,
  });
  const target = await resolveWritableTarget({
    rootPath: args.rootPath,
    relativePath,
  });
  const existing = await readExistingSnapshot({
    targetPath: target.absolutePath,
  });
  if (!existing) {
    return {
      path: target.resultPath,
      deleted: false,
      previousHash: null,
    };
  }

  await fs.rm(target.absolutePath);
  return {
    path: target.resultPath,
    deleted: true,
    previousHash: existing.hash,
  };
}
