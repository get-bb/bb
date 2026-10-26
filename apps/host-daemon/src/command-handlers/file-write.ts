import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { isPathWithinDirectory } from "@bb/process-utils";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type { CommandOf } from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";
import { sha256Hex } from "../sha256-hex.js";
import {
  createMissingTargetError,
  NON_IMAGE_FILE_SIZE_LIMIT_BYTES,
} from "./file-read.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";
import { runInSerialLane } from "../serial-lane.js";
import {
  publishFileWithoutReplacing,
  writeVerifiedFile,
} from "../verified-file-transfer.js";

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

  let currentContents: Buffer | null = null;
  let currentMode: number | undefined;
  try {
    const stat = await fs.stat(target.writePath);
    if (stat.isDirectory()) {
      throw new CommandDispatchError(
        "invalid_path",
        "Path is a directory, not a file",
      );
    }
    currentMode = stat.mode & 0o777;
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
  const mode =
    command.expectedSha256 === undefined
      ? (currentMode ?? command.mode)
      : (command.mode ?? currentMode);
  const temporaryPath = `${target.writePath}.bb-write-${randomUUID()}`;
  try {
    try {
      await writeVerifiedFile({
        destinationPath: temporaryPath,
        durable: true,
        expected: {
          maxBytes: contents.length,
          sha256: null,
          sizeBytes: contents.length,
        },
        label: `File ${command.path}`,
        mode: mode ?? null,
        source: [contents],
      });
    } catch (error) {
      if (
        currentContents !== null &&
        (isFsErrorWithCode(error, "EACCES") ||
          isFsErrorWithCode(error, "EPERM"))
      ) {
        return await overwriteInPlace(command, contents, target.writePath);
      }
      throw error;
    }
    return await publishTemporaryFile(
      command,
      contents,
      temporaryPath,
      target.writePath,
    );
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
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function readCurrentSha256(writePath: string): Promise<string | null> {
  const latest = await fs.readFile(writePath).catch(() => null);
  return latest === null ? null : sha256Hex(latest);
}

async function findLatestConflict(
  command: CommandOf<"host.write_file">,
  writePath: string,
): Promise<HostDaemonOnlineRpcResult<"host.write_file"> | null> {
  if (command.expectedSha256 === undefined) {
    return null;
  }
  const latestSha256 = await readCurrentSha256(writePath);
  return latestSha256 === command.expectedSha256
    ? null
    : { outcome: "conflict", currentSha256: latestSha256 };
}

function writtenResult(
  contents: Buffer,
): HostDaemonOnlineRpcResult<"host.write_file"> {
  return {
    outcome: "written",
    sha256: sha256Hex(contents),
    sizeBytes: contents.length,
  };
}

async function publishTemporaryFile(
  command: CommandOf<"host.write_file">,
  contents: Buffer,
  temporaryPath: string,
  writePath: string,
): Promise<HostDaemonOnlineRpcResult<"host.write_file">> {
  if (command.expectedSha256 === null) {
    if (!(await publishFileWithoutReplacing(temporaryPath, writePath))) {
      return {
        outcome: "conflict",
        currentSha256: await readCurrentSha256(writePath),
      };
    }
    return writtenResult(contents);
  }
  const conflict = await findLatestConflict(command, writePath);
  if (conflict !== null) {
    return conflict;
  }
  await fs.rename(temporaryPath, writePath);
  return writtenResult(contents);
}

async function overwriteInPlace(
  command: CommandOf<"host.write_file">,
  contents: Buffer,
  writePath: string,
): Promise<HostDaemonOnlineRpcResult<"host.write_file">> {
  const conflict = await findLatestConflict(command, writePath);
  if (conflict !== null) {
    return conflict;
  }
  await fs.writeFile(writePath, contents);
  return writtenResult(contents);
}
