import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { toWatchErrorMessage } from "./watch-error.js";

const WORKSPACE_ROOT_ALWAYS_IGNORED_GLOBS = [
  "*/**/.git/**",
  "**/node_modules/**",
  "**/.cache/**",
  "**/__pycache__/**",
];
const NESTED_REPOSITORY_SEARCH_SKIPPED_NAMES = new Set([
  ".git",
  "node_modules",
  ".cache",
  "__pycache__",
]);
const NESTED_REPOSITORY_SEARCH_MAX_DIRECTORIES = 5_000;
const REPOSITORY_STATUS_CONCURRENCY = 4;
const REPOSITORY_STATUS_TIMEOUT_MS = 5_000;
const REPOSITORY_STATUS_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface RepositoryStatusDirectories {
  ignored: string[];
  untracked: string[];
}

interface DirectorySearchBudget {
  remaining: number;
}

interface WorkspaceRootIgnores {
  failures: string[];
  ignore: string[];
}

function runGitIgnoredMatchingStatus(cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      [
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "-z",
        "--ignored=matching",
        "--untracked-files=normal",
      ],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: REPOSITORY_STATUS_MAX_BUFFER_BYTES,
        timeout: REPOSITORY_STATUS_TIMEOUT_MS,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function collectStatusDirectories(
  statusOutput: string,
): RepositoryStatusDirectories {
  const ignored = new Set<string>();
  const untracked = new Set<string>();
  for (const record of statusOutput.split("\0")) {
    if (!record.endsWith("/")) {
      continue;
    }
    const directory = record.slice(3).replace(/\/+$/u, "");
    if (record.startsWith("!! ")) {
      ignored.add(directory);
    } else if (record.startsWith("?? ")) {
      untracked.add(directory);
    }
  }
  return {
    ignored: Array.from(ignored).sort(),
    untracked: Array.from(untracked).sort(),
  };
}

function joinRelativePath(parent: string, child: string): string {
  return parent.length === 0 ? child : `${parent}/${child}`;
}

async function findRepositories(args: {
  budget: DirectorySearchBudget;
  rootPath: string;
  startDirectories: string[];
}): Promise<string[]> {
  const repositories: string[] = [];
  const queue = [...args.startDirectories];
  while (queue.length > 0 && args.budget.remaining > 0) {
    const relativeDirectory = queue.shift() ?? "";
    args.budget.remaining -= 1;
    let entries;
    try {
      entries = await fs.readdir(path.join(args.rootPath, relativeDirectory), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.name === ".git")) {
      repositories.push(relativeDirectory);
      continue;
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !NESTED_REPOSITORY_SEARCH_SKIPPED_NAMES.has(entry.name)
      ) {
        queue.push(joinRelativePath(relativeDirectory, entry.name));
      }
    }
  }
  return repositories;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const pending = items.entries();
  async function worker(): Promise<void> {
    for (const [index, item] of pending) {
      results[index] = await map(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

function createWorkspaceRootBaseIgnores(gitRoot: boolean): string[] {
  return gitRoot
    ? [".git", ...WORKSPACE_ROOT_ALWAYS_IGNORED_GLOBS]
    : [...WORKSPACE_ROOT_ALWAYS_IGNORED_GLOBS];
}

export async function resolveWorkspaceRootIgnores(args: {
  cwd: string;
  gitRoot: boolean;
}): Promise<WorkspaceRootIgnores> {
  const ignore = new Set(createWorkspaceRootBaseIgnores(args.gitRoot));
  const failures: string[] = [];
  const budget: DirectorySearchBudget = {
    remaining: NESTED_REPOSITORY_SEARCH_MAX_DIRECTORIES,
  };
  let repositories = args.gitRoot
    ? [""]
    : await findRepositories({
        budget,
        rootPath: args.cwd,
        startDirectories: [""],
      });
  while (repositories.length > 0) {
    const discovered = await mapWithConcurrency(
      repositories,
      REPOSITORY_STATUS_CONCURRENCY,
      async (repository) => {
        let directories: RepositoryStatusDirectories;
        try {
          directories = collectStatusDirectories(
            await runGitIgnoredMatchingStatus(path.join(args.cwd, repository)),
          );
        } catch (error) {
          failures.push(
            repository.length === 0
              ? toWatchErrorMessage(error)
              : `${repository}: ${toWatchErrorMessage(error)}`,
          );
          return [];
        }
        for (const ignoredDirectory of directories.ignored) {
          ignore.add(joinRelativePath(repository, ignoredDirectory));
        }
        return findRepositories({
          budget,
          rootPath: args.cwd,
          startDirectories: directories.untracked.map((directory) =>
            joinRelativePath(repository, directory),
          ),
        });
      },
    );
    repositories = discovered.flat();
  }
  return { failures, ignore: Array.from(ignore) };
}
