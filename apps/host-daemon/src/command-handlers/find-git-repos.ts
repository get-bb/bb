import fs from "node:fs/promises";
import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { runGit } from "bb-environment-provider-host/workspace-git";
import {
  CommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";

const SKIPPED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  "__pycache__",
  "venv",
]);
const GIT_TOP_LEVEL_TIMEOUT_MS = 5_000;
const WALK_CONCURRENCY = 16;

type FoundFolder =
  HostDaemonOnlineRpcResult<"host.find_git_repos">["folders"][number];
type FoundRepo = FoundFolder["repos"][number];

function isMissingError(error: unknown): boolean {
  return (
    isFsErrorWithCode(error, "ENOENT") || isFsErrorWithCode(error, "ENOTDIR")
  );
}

async function isDirectory(directoryPath: string): Promise<boolean> {
  try {
    return (await fs.stat(directoryPath)).isDirectory();
  } catch (error) {
    if (isMissingError(error) || isFsErrorWithCode(error, "EACCES")) {
      return false;
    }
    throw error;
  }
}

async function hasGitMarker(directoryPath: string): Promise<boolean> {
  try {
    await fs.lstat(path.join(directoryPath, ".git"));
    return true;
  } catch (error) {
    if (isMissingError(error) || isFsErrorWithCode(error, "EACCES")) {
      return false;
    }
    throw error;
  }
}

async function readGitTopLevel(folderPath: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--show-toplevel"], {
    cwd: folderPath,
    allowFailure: true,
    timeoutMs: GIT_TOP_LEVEL_TIMEOUT_MS,
  });
  const topLevel = result.stdout.trim();
  return result.exitCode === 0 && topLevel.length > 0
    ? path.resolve(topLevel)
    : null;
}

async function listChildDirectories(directoryPath: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(directoryPath);
  } catch (error) {
    if (isMissingError(error) || isFsErrorWithCode(error, "EACCES")) {
      return [];
    }
    throw error;
  }
  const candidates = names
    .filter(
      (name) => !name.startsWith(".") && !SKIPPED_DIRECTORY_NAMES.has(name),
    )
    .sort()
    .map((name) => path.join(directoryPath, name));
  const directories: string[] = [];
  for (let index = 0; index < candidates.length; index += WALK_CONCURRENCY) {
    const batch = candidates.slice(index, index + WALK_CONCURRENCY);
    const checks = await Promise.all(batch.map(isDirectory));
    batch.forEach((candidate, batchIndex) => {
      if (checks[batchIndex]) directories.push(candidate);
    });
  }
  return directories;
}

async function findReposInside(args: {
  folderPath: string;
  maxDepth: number;
  maxRepos: number;
}): Promise<{ repos: FoundRepo[]; truncated: boolean }> {
  const repos: FoundRepo[] = [];
  const visited = new Set<string>([await fs.realpath(args.folderPath)]);
  let level = [args.folderPath];
  for (let depth = 1; depth <= args.maxDepth && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const directory of level) {
      for (const child of await listChildDirectories(directory)) {
        const realPath = await fs.realpath(child);
        if (visited.has(realPath)) continue;
        visited.add(realPath);
        if (await hasGitMarker(child)) {
          if (repos.length === args.maxRepos) {
            return { repos, truncated: true };
          }
          repos.push({ path: child, gitRoot: realPath });
        } else {
          next.push(child);
        }
      }
    }
    level = next;
  }
  return { repos, truncated: false };
}

async function inspectFolder(args: {
  folderPath: string;
  maxDepth: number;
  maxRepos: number;
}): Promise<FoundFolder> {
  if (!path.isAbsolute(args.folderPath)) {
    throw new CommandDispatchError(
      "invalid_path",
      "folderPaths entries must be absolute",
    );
  }
  if (!(await isDirectory(args.folderPath))) {
    return {
      path: args.folderPath,
      exists: false,
      gitRoot: null,
      repos: [],
      truncated: false,
    };
  }
  const gitRoot = await readGitTopLevel(args.folderPath);
  if (gitRoot !== null) {
    return {
      path: args.folderPath,
      exists: true,
      gitRoot,
      repos: [],
      truncated: false,
    };
  }
  const found = await findReposInside(args);
  return {
    path: args.folderPath,
    exists: true,
    gitRoot: null,
    repos: found.repos,
    truncated: found.truncated,
  };
}

export async function findGitRepos(
  command: CommandOf<"host.find_git_repos">,
): Promise<HostDaemonOnlineRpcResult<"host.find_git_repos">> {
  const folders = await Promise.all(
    command.folderPaths.map((folderPath) =>
      inspectFolder({
        folderPath,
        maxDepth: command.maxDepth,
        maxRepos: command.maxRepos,
      }),
    ),
  );
  return { folders };
}
