import fs from "node:fs/promises";
import path from "node:path";
import type {
  HostDaemonOnlineRpcResult,
  WorkspaceDirectoryEntry,
  WorkspaceDirectoryEntryKind,
} from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";
import {
  resolveWorkspaceForCommand,
  workspaceResolutionFailureFromError,
} from "../workspace-resolution.js";
import { resolveNonSymlinkDirectoryPath } from "./root-path.js";

interface ListWorkspaceDirectoryPageArgs {
  cursor?: string;
  limit: number;
  relativePath: string;
  workspacePath: string;
}

interface WorkspaceDirectoryPage {
  directory: string;
  entries: WorkspaceDirectoryEntry[];
  nextCursor: string | null;
}

function validateRelativeDirectoryPath(relativePath: string): string[] {
  if (relativePath === "") return [];
  if (
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath)
  ) {
    throw new CommandDispatchError("invalid_path", "Path must be relative");
  }
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new CommandDispatchError("invalid_path", "Path must be relative");
  }
  return segments;
}

function decodeCursor(cursor: string): string {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (
      decoded.length === 0 ||
      Buffer.from(decoded).toString("base64url") !== cursor
    ) {
      throw new Error("Invalid cursor");
    }
    return decoded;
  } catch {
    throw new CommandDispatchError(
      "invalid_cursor",
      "Invalid directory cursor",
    );
  }
}

function encodeCursor(name: string): string {
  return Buffer.from(name).toString("base64url");
}

function entryKind(
  dirent: import("node:fs").Dirent,
): WorkspaceDirectoryEntryKind {
  if (dirent.isSymbolicLink()) return "symlink";
  if (dirent.isDirectory()) return "directory";
  if (dirent.isFile()) return "file";
  return "other";
}

function compareNames(left: { name: string }, right: { name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

async function resolveDirectoryWithoutSymlinks(
  workspacePath: string,
  segments: readonly string[],
): Promise<string> {
  const root = await resolveNonSymlinkDirectoryPath({
    description: "Workspace path",
    path: workspacePath,
  });
  let directory = root;
  for (const segment of segments) {
    directory = path.join(directory, segment);
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink()) {
      throw new CommandDispatchError(
        "invalid_path",
        "Directory path must not traverse a symlink",
      );
    }
    if (!stat.isDirectory()) {
      throw new CommandDispatchError("invalid_path", "Path is not a directory");
    }
  }
  return directory;
}

export async function listWorkspaceDirectoryPage(
  args: ListWorkspaceDirectoryPageArgs,
): Promise<WorkspaceDirectoryPage> {
  const segments = validateRelativeDirectoryPath(args.relativePath);
  const afterName =
    args.cursor === undefined ? null : decodeCursor(args.cursor);
  try {
    const directory = await resolveDirectoryWithoutSymlinks(
      args.workspacePath,
      segments,
    );
    const relativeDirectory = segments.join("/");
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .map(
        (dirent): WorkspaceDirectoryEntry => ({
          kind: entryKind(dirent),
          name: dirent.name,
          path: relativeDirectory
            ? `${relativeDirectory}/${dirent.name}`
            : dirent.name,
        }),
      )
      .sort(compareNames)
      .filter((entry) => afterName === null || entry.name > afterName);
    const page = entries.slice(0, args.limit);
    return {
      directory: relativeDirectory,
      entries: page,
      nextCursor:
        entries.length > args.limit && page.length > 0
          ? encodeCursor(page[page.length - 1]!.name)
          : null,
    };
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      throw new CommandDispatchError(
        "path_not_found",
        `Directory does not exist: ${args.relativePath || "."}`,
      );
    }
    throw error;
  }
}

export async function listWorkspaceDirectory(
  command: CommandOf<"workspace.list_directory">,
  options: CommandDispatchOptions,
): Promise<HostDaemonOnlineRpcResult<"workspace.list_directory">> {
  validateRelativeDirectoryPath(command.path);
  const resolution = await resolveWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  if (!resolution.ok) {
    return { outcome: "unavailable", failure: resolution.failure };
  }
  try {
    return {
      outcome: "available",
      ...(await listWorkspaceDirectoryPage({
        cursor: command.cursor,
        limit: command.limit,
        relativePath: command.path,
        workspacePath: resolution.entry.workspace.path,
      })),
    };
  } catch (error) {
    if (
      error instanceof CommandDispatchError &&
      error.code === "invalid_path"
    ) {
      throw error;
    }
    return {
      outcome: "unavailable",
      failure: workspaceResolutionFailureFromError({
        error,
        workspacePath: command.workspaceContext.workspacePath,
      }),
    };
  }
}
