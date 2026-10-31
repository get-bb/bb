import type { Stats } from "node:fs";
import { opendir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  DiscoverReposResult,
  DiscoveredRepo,
} from "@bb/host-daemon-contract";

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "Library",
  "Applications",
  "target",
  "vendor",
  "dist",
  "build",
  "out",
  "venv",
  "__pycache__",
  "Pictures",
  "Music",
  "Movies",
  "Downloads",
  "AppData",
  "tmp",
  "temp",
]);
const SKIP_DIRECTORY_PREFIXES = ["tmp-", "tmp_"];

const ACTIVITY_MARKERS = ["HEAD", "index", join("logs", "HEAD")];
const WALK_BUDGET_MS = 10_000;
const ORIGIN_READ_BUDGET_MS = 1_000;
const UNREADABLE_PATHS_LIMIT = 20;
const PERMISSION_ERROR_CODES = new Set(["EACCES", "EPERM"]);
const WALK_CONCURRENCY = 32;
const MS_PER_DAY = 86_400_000;

interface FoundRepo {
  path: string;
  lastActivityMs: number;
}

interface DiscoverReposArgs {
  maxDepth: number;
  sinceDays: number;
  limit: number;
  home?: string;
  now?: number;
  walkBudgetMs?: number;
}

async function withDeadline<T>(
  operation: Promise<T>,
  deadline: number,
): Promise<T | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    void operation.catch(() => {});
    return null;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), remaining);
        timer.unref();
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isPermissionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    PERMISSION_ERROR_CODES.has(error.code)
  );
}

async function readLastActivityMs(
  gitDir: string,
  deadline: number,
): Promise<number> {
  const stats = await Promise.all(
    ACTIVITY_MARKERS.map((marker) =>
      withDeadline<Stats>(stat(join(gitDir, marker)), deadline),
    ),
  );
  return Math.max(0, ...stats.map((entry) => entry?.mtimeMs ?? 0));
}

function createLimiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

type DirectoryListing =
  | {
      kind: "listed";
      children: string[];
      gitMarker: "directory" | "file" | null;
    }
  | { kind: "unreadable" }
  | { kind: "failed" };

async function listDirectory(
  dir: string,
  depth: number,
): Promise<DirectoryListing> {
  const children: string[] = [];
  let gitMarker: "directory" | "file" | null = null;
  try {
    for await (const entry of await opendir(dir)) {
      if (entry.name === ".git") {
        if (depth > 0) {
          gitMarker = entry.isDirectory() ? "directory" : "file";
        }
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      if (
        SKIP_DIRECTORY_PREFIXES.some((prefix) => entry.name.startsWith(prefix))
      ) {
        continue;
      }
      children.push(entry.name);
    }
  } catch (error) {
    return { kind: isPermissionError(error) ? "unreadable" : "failed" };
  }
  return { kind: "listed", children, gitMarker };
}

async function walkForRepos(
  root: string,
  maxDepth: number,
  deadline: number,
): Promise<{
  repos: FoundRepo[];
  truncated: boolean;
  unreadablePaths: string[];
}> {
  const repos: FoundRepo[] = [];
  const unreadablePaths: string[] = [];
  let truncated = false;
  const limitOpenDirectories = createLimiter(WALK_CONCURRENCY);

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    if (Date.now() > deadline) {
      truncated = true;
      return;
    }

    const listing = await limitOpenDirectories(() =>
      withDeadline(listDirectory(dir, depth), deadline),
    );
    if (listing === null) {
      truncated = true;
      return;
    }
    if (listing.kind === "unreadable") {
      if (unreadablePaths.length < UNREADABLE_PATHS_LIMIT) {
        unreadablePaths.push(dir);
      }
      return;
    }
    if (listing.kind === "failed") return;

    if (listing.gitMarker === "file") return;
    if (listing.gitMarker === "directory") {
      const lastActivityMs = await readLastActivityMs(
        join(dir, ".git"),
        deadline,
      );
      if (lastActivityMs === 0 && Date.now() > deadline) {
        truncated = true;
        return;
      }
      repos.push({ path: dir, lastActivityMs });
      return;
    }

    await Promise.all(
      listing.children.map((child) => walk(join(dir, child), depth + 1)),
    );
  };

  await walk(root, 0);
  return { repos, truncated, unreadablePaths };
}

async function readOriginUrl(
  repoPath: string,
  deadline: number,
): Promise<string | null> {
  const config = await withDeadline(
    readFile(join(repoPath, ".git", "config"), "utf8"),
    deadline,
  );
  if (config === null) return null;
  const section = config.split(/\[remote "origin"\]/u)[1];
  if (section === undefined) return null;
  const match = /^\s*url\s*=\s*(.+)$/mu.exec(section.split("[")[0] ?? "");
  const url = match?.[1]?.trim();
  return url === undefined || url === "" ? null : url;
}

export async function discoverRepos(
  args: DiscoverReposArgs,
): Promise<DiscoverReposResult> {
  const home = args.home ?? homedir();
  const now = args.now ?? Date.now();
  const { repos, truncated, unreadablePaths } = await walkForRepos(
    home,
    args.maxDepth,
    Date.now() + (args.walkBudgetMs ?? WALK_BUDGET_MS),
  );

  const cutoff = now - args.sinceDays * MS_PER_DAY;
  const recent = repos
    .filter((repo) => repo.lastActivityMs >= cutoff)
    .sort((left, right) => right.lastActivityMs - left.lastActivityMs)
    .slice(0, args.limit);
  const originDeadline = Date.now() + ORIGIN_READ_BUDGET_MS;

  return {
    repos: await Promise.all(
      recent.map(async (repo): Promise<DiscoveredRepo> => ({
        path: repo.path,
        name: basename(repo.path),
        lastActivityAt: new Date(repo.lastActivityMs).toISOString(),
        originUrl: await readOriginUrl(repo.path, originDeadline),
      })),
    ),
    truncated,
    unreadablePaths,
  };
}
