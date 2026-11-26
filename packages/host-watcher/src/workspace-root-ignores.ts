import {
  execHostFileCallback as execFile,
  runVcsProcess,
  type VcsProcessPriority,
} from "@bb/process-utils";
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
  dropIgnoredPaths: (changedPaths: string[]) => Promise<string[]>;
  failures: string[];
  ignore: string[];
}

function runGit(args: {
  cwd: string;
  gitArgs: string[];
  input?: string;
  priority: VcsProcessPriority;
}): Promise<string> {
  return runVcsProcess(
    "git",
    args.gitArgs,
    () =>
      new Promise<string>((resolve, reject) => {
        const child = execFile(
          "git",
          args.gitArgs,
          {
            cwd: args.cwd,
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
        if (args.input !== undefined) {
          child.stdin?.end(args.input);
        }
      }),
    { priority: args.priority },
  );
}

function runGitIgnoredMatchingStatus(cwd: string): Promise<string> {
  return runGit({
    cwd,
    gitArgs: [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "-z",
      "--ignored=matching",
      "--untracked-files=normal",
    ],
    priority: "background",
  });
}

async function runGitCheckIgnore(
  cwd: string,
  relativePaths: string[],
): Promise<string[]> {
  let stdout: string;
  try {
    stdout = await runGit({
      cwd,
      gitArgs: ["--no-optional-locks", "check-ignore", "--stdin", "-z"],
      input: `${relativePaths.join("\0")}\0`,
      priority: "status",
    });
  } catch (error) {
    if (isExecExitCode(error, 1)) {
      return [];
    }
    throw error;
  }
  return stdout.split("\0").filter((record) => record.length > 0);
}

function isExecExitCode(error: unknown, code: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
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

function isWithinRepository(
  repository: string,
  relativeDirectory: string,
): boolean {
  return (
    repository.length === 0 || relativeDirectory.startsWith(`${repository}/`)
  );
}

function findDeepestRepository(
  repositories: readonly string[],
  relativeDirectory: string,
): string | undefined {
  let deepest: string | undefined;
  for (const repository of repositories) {
    if (
      isWithinRepository(repository, relativeDirectory) &&
      (deepest === undefined || repository.length > deepest.length)
    ) {
      deepest = repository;
    }
  }
  return deepest;
}

function listAncestorDirectories(relativePath: string): string[] {
  const segments = relativePath.split("/");
  return segments
    .slice(0, -1)
    .map((_segment, index) => segments.slice(0, index + 1).join("/"));
}

function createIgnoredPathDropper(args: {
  cwd: string;
  ignoredDirectories: Set<string>;
  repositories: readonly string[];
  rootPath: string;
}): (changedPaths: string[]) => Promise<string[]> {
  const classifications = new Map<string, Promise<void>>();

  function classifyDirectories(
    repository: string,
    relativeDirectories: string[],
  ): Promise<void> {
    const classification = runGitCheckIgnore(
      path.join(args.cwd, repository),
      relativeDirectories.map((relativeDirectory) =>
        repository.length === 0
          ? relativeDirectory
          : relativeDirectory.slice(repository.length + 1),
      ),
    ).then(
      (ignored) => {
        for (const ignoredDirectory of ignored) {
          args.ignoredDirectories.add(
            joinRelativePath(repository, ignoredDirectory),
          );
        }
      },
      () => {
        for (const relativeDirectory of relativeDirectories) {
          classifications.delete(relativeDirectory);
        }
      },
    );
    for (const relativeDirectory of relativeDirectories) {
      classifications.set(relativeDirectory, classification);
    }
    return classification;
  }

  function hasIgnoredAncestor(relativePath: string): boolean {
    return [...listAncestorDirectories(relativePath), relativePath].some(
      (directory) => args.ignoredDirectories.has(directory),
    );
  }

  return async (changedPaths) => {
    const relativePaths = changedPaths.map((changedPath) =>
      path.relative(args.rootPath, changedPath).split(path.sep).join("/"),
    );
    const pending = new Set<Promise<void>>();
    const unclassifiedByRepository = new Map<string, Set<string>>();
    for (const relativePath of relativePaths) {
      for (const directory of listAncestorDirectories(relativePath)) {
        if (args.ignoredDirectories.has(directory)) {
          break;
        }
        const classification = classifications.get(directory);
        if (classification) {
          pending.add(classification);
          continue;
        }
        const repository = findDeepestRepository(args.repositories, directory);
        if (repository === undefined) {
          classifications.set(directory, Promise.resolve());
          continue;
        }
        const unclassified =
          unclassifiedByRepository.get(repository) ?? new Set<string>();
        unclassified.add(directory);
        unclassifiedByRepository.set(repository, unclassified);
      }
    }
    for (const [repository, directories] of unclassifiedByRepository) {
      pending.add(classifyDirectories(repository, Array.from(directories)));
    }
    await Promise.all(pending);
    return changedPaths.filter(
      (_changedPath, index) => !hasIgnoredAncestor(relativePaths[index] ?? ""),
    );
  };
}

function createWorkspaceRootBaseIgnores(gitRoot: boolean): string[] {
  return gitRoot
    ? [".git", ...WORKSPACE_ROOT_ALWAYS_IGNORED_GLOBS]
    : [...WORKSPACE_ROOT_ALWAYS_IGNORED_GLOBS];
}

export async function resolveWorkspaceRootIgnores(args: {
  cwd: string;
  gitRoot: boolean;
  rootPath: string;
}): Promise<WorkspaceRootIgnores> {
  const ignore = new Set(createWorkspaceRootBaseIgnores(args.gitRoot));
  const ignoredDirectories = new Set<string>();
  const statusRepositories: string[] = [];
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
        statusRepositories.push(repository);
        for (const ignoredDirectory of directories.ignored) {
          const relativeDirectory = joinRelativePath(
            repository,
            ignoredDirectory,
          );
          ignore.add(relativeDirectory);
          ignoredDirectories.add(relativeDirectory);
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
  return {
    dropIgnoredPaths: createIgnoredPathDropper({
      cwd: args.cwd,
      ignoredDirectories,
      repositories: statusRepositories,
      rootPath: args.rootPath,
    }),
    failures,
    ignore: Array.from(ignore),
  };
}
