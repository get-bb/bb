import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  ExpectedCommandDispatchError,
} from "../command-dispatch-support.js";
import type { CommandOf } from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";
import { NON_IMAGE_FILE_SIZE_LIMIT_BYTES, sha256Hex } from "./file-read.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";

interface ResolvedWriteTarget {
  /** Real (symlink-resolved) path to write, existing or not. */
  writePath: string;
  /** True when the write target's direct parent directory is missing. */
  parentMissing: boolean;
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function createMissingTargetError(
  resultPath: string,
): ExpectedCommandDispatchError {
  return new ExpectedCommandDispatchError(
    "ENOENT",
    `Path does not exist: ${resultPath}`,
  );
}

/**
 * Resolve the write target through symlinks even though it may not exist yet:
 * realpath the nearest existing ancestor and re-append the missing segments.
 * Containment (when a root is declared) is checked against this resolved
 * path, so a symlinked directory inside the root cannot smuggle a write
 * outside it.
 */
async function resolveWriteTarget(
  resolvedPath: string,
  resultPath: string,
): Promise<ResolvedWriteTarget> {
  try {
    return { writePath: await fs.realpath(resolvedPath), parentMissing: false };
  } catch (error) {
    if (!isFsErrorWithCode(error, "ENOENT")) {
      throw error;
    }
  }

  const missingSegments = [path.basename(resolvedPath)];
  let ancestor = path.dirname(resolvedPath);
  for (;;) {
    try {
      const realAncestor = await fs.realpath(ancestor);
      return {
        writePath: path.join(realAncestor, ...missingSegments),
        parentMissing: missingSegments.length > 1,
      };
    } catch (error) {
      if (!isFsErrorWithCode(error, "ENOENT")) {
        throw error;
      }
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      throw createMissingTargetError(resultPath);
    }
    missingSegments.unshift(path.basename(ancestor));
    ancestor = parent;
  }
}

export async function writeHostFile(
  command: CommandOf<"host.write_file">,
): Promise<HostDaemonOnlineRpcResult<"host.write_file">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }
  if (command.rootPath !== undefined && !path.isAbsolute(command.rootPath)) {
    throw new CommandDispatchError("invalid_path", "rootPath must be absolute");
  }

  const contents = Buffer.from(command.content, command.contentEncoding);
  if (contents.length > NON_IMAGE_FILE_SIZE_LIMIT_BYTES) {
    throw new CommandDispatchError(
      "file_too_large",
      `File size ${contents.length} bytes exceeds the ${Math.floor(NON_IMAGE_FILE_SIZE_LIMIT_BYTES / (1024 * 1024))} MB limit`,
    );
  }

  const resolvedPath = path.resolve(command.path);
  const target = await resolveWriteTarget(resolvedPath, command.path);

  if (command.rootPath !== undefined) {
    let realRootPath: string;
    try {
      realRootPath = await resolveNonSymlinkDirectoryPath({
        description: "Root path",
        path: command.rootPath,
      });
    } catch (error) {
      if (isFsErrorWithCode(error, "ENOENT")) {
        throw createMissingTargetError(command.path);
      }
      throw error;
    }
    if (!isPathWithinRoot(target.writePath, realRootPath)) {
      throw new CommandDispatchError(
        "invalid_path",
        `Path "${command.path}" escapes write root`,
      );
    }
  }

  if (target.parentMissing && !command.createParents) {
    throw createMissingTargetError(path.dirname(command.path));
  }

  let currentContents: Buffer | null = null;
  try {
    const stat = await fs.stat(target.writePath);
    if (stat.isDirectory()) {
      throw new CommandDispatchError(
        "invalid_path",
        "Path is a directory, not a file",
      );
    }
    currentContents = await fs.readFile(target.writePath);
  } catch (error) {
    if (!isFsErrorWithCode(error, "ENOENT")) {
      throw error;
    }
  }
  const currentSha256 =
    currentContents === null ? null : sha256Hex(currentContents);

  if (
    command.expectedSha256 !== undefined &&
    command.expectedSha256 !== currentSha256
  ) {
    return { outcome: "conflict", currentSha256 };
  }

  if (command.createParents) {
    await fs.mkdir(path.dirname(target.writePath), { recursive: true });
  }
  try {
    await fs.writeFile(target.writePath, contents);
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      throw createMissingTargetError(path.dirname(command.path));
    }
    if (
      isFsErrorWithCode(error, "ENOTDIR") ||
      isFsErrorWithCode(error, "EISDIR")
    ) {
      throw new CommandDispatchError(
        "invalid_path",
        `Cannot write file at ${command.path}`,
      );
    }
    throw error;
  }

  return {
    outcome: "written",
    sha256: sha256Hex(contents),
    sizeBytes: contents.length,
  };
}
