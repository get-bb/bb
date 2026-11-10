import { experimental_execHostFileCallback as execFile } from "@get-bb/plugin-sdk/process";
import fs from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { hostStorageContract } from "./host-contract.js";
import { isFsErrorWithCode } from "./fs-errors.js";

type ListOutput = z.infer<typeof hostStorageContract.listGitWorktrees.output>;
type Worktree = ListOutput["repositories"][number]["worktrees"][number];
type RemoveOutput = z.infer<
  typeof hostStorageContract.removeGitWorktrees.output
>["results"][number];
type SkipReason = Extract<
  RemoveOutput,
  { outcome: "skipped" }
>["reasons"][number];

const GIT_TIMEOUT_MS = 60_000;

function git(
  args: string[],
  cwd: string,
  signal: AbortSignal,
  timeoutMs = GIT_TIMEOUT_MS,
) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      execFile(
        "git",
        args,
        {
          cwd,
          signal,
          timeout: timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") reject(error);
          else
            resolve({
              exitCode: typeof error?.code === "number" ? error.code : 0,
              stdout,
              stderr: stderr.trim(),
            });
        },
      );
    },
  );
}

function parseWorktreeList(stdout: string) {
  const entries: {
    path: string;
    head: string | null;
    branch: string | null;
    locked: boolean;
    bare: boolean;
    prunable: boolean;
  }[] = [];
  for (const record of stdout.split("\0\0")) {
    const fields = record.split("\0").filter(Boolean);
    const worktreePath = fields[0]?.startsWith("worktree ")
      ? path.normalize(fields[0].slice("worktree ".length))
      : null;
    if (worktreePath === null) continue;
    const value = (key: string) =>
      fields
        .find((field) => field === key || field.startsWith(`${key} `))
        ?.slice(key.length + 1);
    const branch = value("branch");
    entries.push({
      path: worktreePath,
      head: value("HEAD") || null,
      branch: branch?.replace(/^refs\/heads\//, "") ?? null,
      locked: value("locked") !== undefined,
      bare: value("bare") !== undefined,
      prunable: value("prunable") !== undefined,
    });
  }
  return entries;
}

async function lastActivityAt(worktreePath: string) {
  const dotGit = path.join(worktreePath, ".git");
  const gitDir = await fs
    .readFile(dotGit, "utf8")
    .then((text) => /^gitdir: (.+)$/m.exec(text)?.[1]?.trim() ?? null)
    .catch(() => null);
  if (gitDir === null) return null;
  const times = await Promise.all(
    ["HEAD", "index", path.join("logs", "HEAD")].map((name) =>
      fs.stat(path.resolve(worktreePath, gitDir, name)).then(
        (stats) => stats.mtimeMs,
        () => 0,
      ),
    ),
  );
  const latest = Math.max(...times);
  return latest > 0 ? Math.round(latest) : null;
}

async function listRepository(repositoryPath: string, signal: AbortSignal) {
  const result = await git(
    ["worktree", "list", "--porcelain", "-z"],
    repositoryPath,
    signal,
  );
  if (result.exitCode !== 0)
    throw new Error(result.stderr || "git worktree list failed");
  return parseWorktreeList(result.stdout);
}

function parseStatus(stdout: string) {
  const tokens = stdout.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.length < 4) continue;
    paths.push(token.slice(3));
    if (token[0] === "R" || token[0] === "C") index++;
  }
  return paths;
}

async function latestModification(root: string, relativePaths: string[]) {
  const times = await Promise.all(
    relativePaths.slice(0, 500).map((relative) =>
      fs.lstat(path.join(root, relative)).then(
        (stats) => stats.mtimeMs,
        () => 0,
      ),
    ),
  );
  const latest = Math.max(0, ...times);
  return latest > 0 ? Math.round(latest) : null;
}

async function inspect(
  entry: { path: string; head: string | null; branch: string | null },
  signal: AbortSignal,
) {
  const status = await git(
    ["status", "--porcelain", "-z", "--untracked-files=normal"],
    entry.path,
    signal,
  );
  if (status.exitCode !== 0)
    throw new Error(status.stderr || "git status failed");
  const changed = parseStatus(status.stdout);
  let unsavedCommitCount = 0;
  if (entry.branch === null && entry.head !== null) {
    const unsaved = await git(
      [
        "rev-list",
        "--count",
        entry.head,
        "--not",
        "--branches",
        "--tags",
        "--remotes",
      ],
      entry.path,
      signal,
    );
    if (unsaved.exitCode !== 0)
      throw new Error(unsaved.stderr || "git rev-list failed");
    unsavedCommitCount = Number(unsaved.stdout.trim());
  }
  return {
    changedFileCount: changed.length,
    unsavedCommitCount,
    changedAt: await latestModification(entry.path, changed),
  };
}

export async function inspectCheckouts(
  { paths }: { paths: string[] },
  signal: AbortSignal,
) {
  if (paths.some((target) => !path.isAbsolute(target)))
    throw new Error("Checkout paths must be absolute");
  return {
    checkouts: await mapConcurrently(paths, 4, async (target) => {
      signal.throwIfAborted();
      try {
        if (!(await fs.stat(target)).isDirectory())
          return { path: target, state: "missing" as const };
      } catch (error) {
        if (isFsErrorWithCode(error, "ENOENT"))
          return { path: target, state: "missing" as const };
        throw error;
      }
      const status = await git(
        ["status", "--porcelain", "-z", "--untracked-files=normal"],
        target,
        signal,
      );
      if (status.exitCode !== 0)
        return { path: target, state: "notGit" as const };
      const changedFileCount = parseStatus(status.stdout).length;
      return changedFileCount > 0
        ? { path: target, state: "changed" as const, changedFileCount }
        : { path: target, state: "clean" as const };
    }),
  };
}

async function mapConcurrently<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]!);
      }
    }),
  );
  return results;
}

export async function listGitWorktrees(
  {
    repositoryPaths,
    ownedPaths,
  }: { repositoryPaths: string[]; ownedPaths: string[] },
  signal: AbortSignal,
): Promise<ListOutput> {
  const owned = new Set(
    ownedPaths.map((ownedPath) => path.normalize(ownedPath)),
  );
  const repositories: ListOutput["repositories"] = [];
  const failures: ListOutput["failures"] = [];
  const seen = new Set<string>();
  for (const repositoryPath of repositoryPaths) {
    signal.throwIfAborted();
    let entries;
    try {
      entries = await listRepository(repositoryPath, signal);
    } catch (error) {
      signal.throwIfAborted();
      failures.push({
        repositoryPath,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const [main, ...linked] = entries;
    if (main === undefined || seen.has(main.path)) continue;
    seen.add(main.path);
    const worktrees = await mapConcurrently(
      linked.filter(
        (entry) => !entry.bare && !entry.prunable && !owned.has(entry.path),
      ),
      4,
      async (entry): Promise<Worktree> => {
        const { changedAt, ...state } = await inspect(entry, signal).catch(
          () => {
            signal.throwIfAborted();
            return {
              changedFileCount: null,
              unsavedCommitCount: null,
              changedAt: null,
            };
          },
        );
        const gitActivityAt = await lastActivityAt(entry.path);
        return {
          path: entry.path,
          head: entry.head,
          branch: entry.branch,
          locked: entry.locked,
          ...state,
          lastActivityAt:
            gitActivityAt === null && changedAt === null
              ? null
              : Math.max(gitActivityAt ?? 0, changedAt ?? 0),
        };
      },
    );
    repositories.push({ repositoryPath, mainPath: main.path, worktrees });
  }
  return { repositories, failures };
}

async function check(
  repositoryPath: string,
  worktreePath: string,
  force: boolean,
  signal: AbortSignal,
) {
  const [main, ...linked] = await listRepository(repositoryPath, signal);
  const entry = linked.find(
    (candidate) =>
      main !== undefined &&
      candidate.path !== main.path &&
      path.relative(candidate.path, worktreePath) === "",
  );
  if (entry === undefined || entry.bare || entry.prunable)
    return { entry: null, reasons: ["notWorktree"] as SkipReason[] };
  if (force) return { entry, reasons: [] };
  const { changedFileCount, unsavedCommitCount } = await inspect(entry, signal);
  const reasons: SkipReason[] = [
    ...(entry.locked ? (["locked"] as const) : []),
    ...(changedFileCount > 0 ? (["uncommittedChanges"] as const) : []),
    ...(unsavedCommitCount > 0 ? (["unsavedCommits"] as const) : []),
  ];
  return { entry, reasons };
}

async function pathMissing(target: string) {
  try {
    await fs.lstat(target);
    return false;
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) return true;
    throw error;
  }
}

async function removeOne(
  repositoryPath: string,
  worktreePath: string,
  force: boolean,
  signal: AbortSignal,
): Promise<RemoveOutput> {
  const { entry, reasons } = await check(
    repositoryPath,
    worktreePath,
    force,
    signal,
  );
  if (entry === null && (await pathMissing(worktreePath)))
    return { path: worktreePath, outcome: "removed" };
  if (entry === null || reasons.length > 0)
    return { path: worktreePath, outcome: "skipped", reasons };
  signal.throwIfAborted();
  const removal = await git(
    [
      "worktree",
      "remove",
      ...(force ? ["--force"] : []),
      ...(force && entry.locked ? ["--force"] : []),
      worktreePath,
    ],
    repositoryPath,
    signal,
    0,
  );
  if (removal.exitCode !== 0)
    throw new Error(removal.stderr || "git worktree remove failed");
  return { path: worktreePath, outcome: "removed" };
}

function assertAbsolute(repositoryPath: string, paths: string[]) {
  if (
    !path.isAbsolute(repositoryPath) ||
    paths.some((target) => !path.isAbsolute(target))
  )
    throw new Error("Worktree paths must be absolute");
}

export async function inspectGitWorktree(
  {
    repositoryPath,
    path: worktreePath,
  }: { repositoryPath: string; path: string },
  signal: AbortSignal,
) {
  assertAbsolute(repositoryPath, [worktreePath]);
  const { reasons } = await check(repositoryPath, worktreePath, false, signal);
  return { reasons };
}

export async function removeGitWorktrees(
  {
    repositoryPath,
    paths,
    force,
  }: { repositoryPath: string; paths: string[]; force: boolean },
  signal: AbortSignal,
) {
  assertAbsolute(repositoryPath, paths);
  const results: RemoveOutput[] = [];
  for (const target of paths) {
    signal.throwIfAborted();
    try {
      results.push(await removeOne(repositoryPath, target, force, signal));
    } catch (error) {
      signal.throwIfAborted();
      results.push({
        path: target,
        outcome: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { results };
}
