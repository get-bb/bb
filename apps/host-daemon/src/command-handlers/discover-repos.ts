import type { Dir, Stats } from "node:fs";
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
const WALK_BUDGET_MS = 3_000;
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
  disposeLate?: (value: T) => void,
): Promise<T | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    void operation.then((value) => disposeLate?.(value)).catch(() => {});
    return null;
  }
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    const result = await Promise.race([
      operation.then((value) => {
        if (timedOut) disposeLate?.(value);
        return value;
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, remaining);
        timer.unref();
      }),
    ]);
    return timedOut ? null : result;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function closeLateDir(dir: Dir): void {
  void dir.close().catch(() => {});
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

async function walkForRepos(
  root: string,
  maxDepth: number,
  deadline: number,
): Promise<{ repos: FoundRepo[]; truncated: boolean }> {
  const repos: FoundRepo[] = [];
  let truncated = false;
  const limitOpenDirectories = createLimiter(WALK_CONCURRENCY);

  const readDirectory = async (
    dir: string,
    depth: number,
  ): Promise<{
    children: string[];
    gitMarker: "directory" | "file" | null;
  } | null> => {
    const handle = await withDeadline(opendir(dir), deadline, closeLateDir);
    if (handle === null) {
      if (Date.now() > deadline) truncated = true;
      return null;
    }

    const children: string[] = [];
    let gitMarker: "directory" | "file" | null = null;
    try {
      for await (const entry of handle) {
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
          SKIP_DIRECTORY_PREFIXES.some((prefix) =>
            entry.name.startsWith(prefix),
          )
        ) {
          continue;
        }
        children.push(entry.name);
      }
    } catch {
      return null;
    }
    return { children, gitMarker };
  };

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    if (Date.now() > deadline) {
      truncated = true;
      return;
    }

    const listing = await limitOpenDirectories(() => readDirectory(dir, depth));
    if (listing === null) return;

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
  return { repos, truncated };
}

async function readOriginUrl(repoPath: string): Promise<string | null> {
  let config: string;
  try {
    config = await readFile(join(repoPath, ".git", "config"), "utf8");
  } catch {
    return null;
  }
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
  const { repos, truncated } = await walkForRepos(
    home,
    args.maxDepth,
    Date.now() + (args.walkBudgetMs ?? WALK_BUDGET_MS),
  );

  const cutoff = now - args.sinceDays * MS_PER_DAY;
  const recent = repos
    .filter((repo) => repo.lastActivityMs >= cutoff)
    .sort((left, right) => right.lastActivityMs - left.lastActivityMs)
    .slice(0, args.limit);

  return {
    repos: await Promise.all(
      recent.map(async (repo): Promise<DiscoveredRepo> => ({
        path: repo.path,
        name: basename(repo.path),
        lastActivityAt: new Date(repo.lastActivityMs).toISOString(),
        originUrl: await readOriginUrl(repo.path),
      })),
    ),
    truncated,
  };
}
