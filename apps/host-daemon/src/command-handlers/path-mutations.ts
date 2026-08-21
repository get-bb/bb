import fs from "node:fs/promises";
import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type { CommandOf } from "../command-dispatch-support.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";
import { isPathWithinRoot } from "./file-read.js";
import { resolveWriteTarget } from "./file-write.js";

function assertAbsolute(value: string, field: string): void {
  if (!path.isAbsolute(value)) {
    throw new CommandDispatchError("invalid_path", `${field} must be absolute`);
  }
}

async function requireRoot(
  rootPath: string | undefined,
): Promise<string | null> {
  if (rootPath === undefined) return null;
  assertAbsolute(rootPath, "rootPath");
  return resolveNonSymlinkDirectoryPath({
    description: "Root path",
    path: rootPath,
  });
}

async function requireExistingWithin(
  targetPath: string,
  rootPath: string | undefined,
): Promise<{ target: string; root: string | null }> {
  assertAbsolute(targetPath, "Path");
  const targetInfo = await fs.lstat(targetPath);
  if (targetInfo.isSymbolicLink()) {
    throw new CommandDispatchError(
      "invalid_path",
      `Path "${targetPath}" must not be a symbolic link`,
    );
  }
  const [target, root] = await Promise.all([
    fs.realpath(targetPath),
    requireRoot(rootPath),
  ]);
  if (root !== null && !isPathWithinRoot(target, root)) {
    throw new CommandDispatchError(
      "invalid_path",
      `Path "${targetPath}" escapes root`,
    );
  }
  return { target, root };
}

async function requireDestinationWithin(
  destinationPath: string,
  rootPath: string | undefined,
): Promise<string> {
  assertAbsolute(destinationPath, "destinationPath");
  const [parent, root] = await Promise.all([
    fs.realpath(path.dirname(destinationPath)),
    requireRoot(rootPath),
  ]);
  const target = path.join(parent, path.basename(destinationPath));
  if (root !== null && !isPathWithinRoot(target, root)) {
    throw new CommandDispatchError(
      "invalid_path",
      `Path "${destinationPath}" escapes root`,
    );
  }
  return target;
}

export async function mkdirHostPath(
  command: CommandOf<"host.mkdir">,
): Promise<HostDaemonOnlineRpcResult<"host.mkdir">> {
  assertAbsolute(command.path, "Path");
  const root = await requireRoot(command.rootPath);
  const target = await resolveWriteTarget(command.path, command.path);
  if (root !== null && !isPathWithinRoot(target.writePath, root)) {
    throw new CommandDispatchError(
      "invalid_path",
      `Path "${command.path}" escapes root`,
    );
  }
  await fs.mkdir(target.writePath, { recursive: command.recursive });
  return { ok: true };
}

export async function moveHostPath(
  command: CommandOf<"host.move_path">,
): Promise<HostDaemonOnlineRpcResult<"host.move_path">> {
  const { target: source } = await requireExistingWithin(
    command.sourcePath,
    command.rootPath,
  );
  const destination = await requireDestinationWithin(
    command.destinationPath,
    command.rootPath,
  );
  try {
    await fs.lstat(destination);
    throw new CommandDispatchError(
      "path_exists",
      `Destination already exists: ${command.destinationPath}`,
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  await fs.rename(source, destination);
  return { ok: true };
}

export async function removeHostPath(
  command: CommandOf<"host.remove_path">,
): Promise<HostDaemonOnlineRpcResult<"host.remove_path">> {
  const { target, root } = await requireExistingWithin(
    command.path,
    command.rootPath,
  );
  if (root !== null && target === root) {
    throw new CommandDispatchError(
      "invalid_path",
      "Cannot remove the declared root",
    );
  }
  const targetInfo = await fs.lstat(target);
  if (targetInfo.isDirectory() && !command.recursive) {
    await fs.rmdir(target);
  } else {
    await fs.rm(target, { recursive: command.recursive, force: false });
  }
  return { ok: true };
}
