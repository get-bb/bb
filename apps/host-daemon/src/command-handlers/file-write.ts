import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { replaceFile } from "@bb/file-transfer";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { isPathWithinDirectory } from "@bb/process-utils";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type { CommandOf } from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";
import {
  createMissingTargetError,
  NON_IMAGE_FILE_SIZE_LIMIT_BYTES,
} from "./file-read.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";
import { runInSerialLane } from "../serial-lane.js";

const guardedWriteTails = new Map<string, Promise<void>>();

interface ResolvedWriteTarget {
  writePath: string;
  parentMissing: boolean;
}

export async function resolveWriteTarget(
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

  const write = () => writeResolvedHostFile(command, contents, target);
  return runInSerialLane(guardedWriteTails, target.writePath, write);
}

async function writeResolvedHostFile(
  command: CommandOf<"host.write_file">,
  contents: Buffer,
  target: ResolvedWriteTarget,
): Promise<HostDaemonOnlineRpcResult<"host.write_file">> {
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
    if (!isPathWithinDirectory(realRootPath, target.writePath)) {
      throw new CommandDispatchError(
        "invalid_path",
        `Path "${command.path}" escapes write root`,
      );
    }
  }

  if (target.parentMissing && !command.createParents) {
    throw createMissingTargetError(path.dirname(command.path));
  }

  try {
    if (command.createParents) {
      await fs.mkdir(path.dirname(target.writePath), { recursive: true });
    }
    return await replaceFile({
      contents,
      ...(command.expectedSha256 !== undefined
        ? { expectedSha256: command.expectedSha256 }
        : {}),
      ...(command.mode !== undefined ? { mode: command.mode } : {}),
      path: target.writePath,
    });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      throw createMissingTargetError(path.dirname(command.path));
    }
    if (isFsErrorWithCode(error, "EISDIR")) {
      throw new CommandDispatchError(
        "invalid_path",
        "Path is a directory, not a file",
      );
    }
    if (isFsErrorWithCode(error, "ENOTDIR")) {
      throw new CommandDispatchError(
        "invalid_path",
        `Cannot write file at ${command.path}`,
      );
    }
    throw error;
  }
}
