import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  DiscoverReposResult,
  DiscoveredRepo,
} from "@bb/host-daemon-contract";

/**
 * Find candidate projects on this host: git repositories under the user's home
 * directory, ranked by how likely the user wants them in bb.
 *
 * The walk is cheap because of one rule: stop descending the moment a directory
 * contains `.git`. Everything below a repo root belongs to that repo, so we
 * never enter `node_modules`, `target`, `dist`, or any other build tree inside
 * a project. Measured on a real developer home directory this visits ~77
 * directories in ~5ms, versus ~5,100 for a naive `find -name .git -prune`.
 *
 * Cold page cache — not CPU — is the real cost, so the walk is time-boxed and
 * reports `truncated` rather than blocking onboarding on a slow or
 * network-mounted home directory.
 */

/**
 * Races a filesystem call against the walk deadline. `opendir`/`stat` on a dead
 * network mount can block indefinitely with no abort signal, so a per-call
 * ceiling is the only thing that keeps discovery bounded.
 */
async function withDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  /** Releases a result that arrives after the deadline, so nothing leaks. */
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
        // The race already resolved null; this value has no owner.
        if (timedOut) disposeLate?.(value);
        return value;
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, remaining);
        timer.unref?.();
      }),
    ]);
    return timedOut ? null : result;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Directories that never contain a user project and are expensive to enter. */
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
]);

const WALK_BUDGET_MS = 3_000;
/**
 * Directories opened at once. Unbounded recursion over a wide home directory
 * can start thousands of `opendir` calls together and reach the process file
 * limit, which would disrupt active agent work on the same daemon.
 */
const WALK_CONCURRENCY = 32;
const AGENT_HISTORY_BUDGET_MS = 2_000;

interface FoundRepo {
  path: string;
  lastActivityMs: number;
}

/**
 * Walk `root` breadth-first to `maxDepth`, stopping at each repo root.
 *
 * Dot-directories are skipped deliberately, and not only for speed: on a real
 * machine the repos they hide were inside `.nvm`, `.codex/.tmp`, and `.bb-dev`
 * — tool internals, never user projects.
 */
async function walkForRepos(
  root: string,
  maxDepth: number,
  deadline: number,
): Promise<{ repos: FoundRepo[]; truncated: boolean }> {
  const repos: FoundRepo[] = [];
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    if (Date.now() > deadline) {
      truncated = true;
      return;
    }

    // Unreadable or hung directory (permissions, broken mount) is not an error
    // here — it just contributes nothing.
    const handle = await withDeadline(opendir(dir), deadline, (late) => {
      void late.close().catch(() => {});
    });
    if (handle === null) {
      if (Date.now() > deadline) truncated = true;
      return;
    }

    const children: string[] = [];
    let isRepo = false;
    try {
      for await (const entry of handle) {
        // Linked worktrees and submodules carry `.git` as a file pointing at
        // the real git dir, so the name check has to come before the
        // directory check or those repos are never detected.
        if (entry.name === ".git") {
          isRepo = true;
          continue;
        }
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        children.push(entry.name);
      }
    } catch {
      return;
    }

    if (isRepo) {
      // Stop here. Nested repos below a repo root are submodules or vendored
      // copies, not separate projects the user thinks about.
      // `.git/HEAD` is the best activity signal, but a linked worktree or
      // submodule has `.git` as a file, so fall back to stat-ing the marker
      // itself. Leaving mtime 0 would drop those repos at the recency filter.
      const head = await withDeadline(
        stat(join(dir, ".git", "HEAD")),
        deadline,
      );
      const marker =
        head ?? (await withDeadline(stat(join(dir, ".git")), deadline));
      const lastActivityMs = marker?.mtimeMs ?? 0;
      repos.push({ path: dir, lastActivityMs });
      return;
    }

    for (let index = 0; index < children.length; index += WALK_CONCURRENCY) {
      if (Date.now() > deadline) {
        truncated = true;
        return;
      }
      await Promise.all(
        children
          .slice(index, index + WALK_CONCURRENCY)
          .map((child) => walk(join(dir, child), depth + 1)),
      );
    }
  };

  await walk(root, 0);
  return { repos, truncated };
}

/** `git config --get remote.origin.url`, read straight from the config file. */
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
  return match?.[1]?.trim() ?? null;
}

/**
 * Normalize a remote URL so `git@github.com:o/r.git` and
 * `https://github.com/o/r` collapse to the same key. Only used to join agent
 * history to repos, never shown to the user.
 */
function normalizeOrigin(url: string | null): string | null {
  if (!url) return null;
  return url
    .trim()
    .replace(/\.git$/u, "")
    .replace(/^git@([^:]+):/u, "https://$1/")
    .replace(/^ssh:\/\/git@/u, "https://")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

/**
 * Directories where Claude Code has been run. `~/.claude.json` holds a flat
 * `projects` map keyed by absolute path, with no recency.
 */
async function readClaudeHistory(home: string): Promise<Map<string, number>> {
  const seen = new Map<string, number>();
  let raw: string;
  try {
    raw = await readFile(join(home, ".claude.json"), "utf8");
  } catch {
    return seen;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const projects =
      typeof parsed === "object" && parsed !== null && "projects" in parsed
        ? (parsed as { projects: unknown }).projects
        : null;
    if (typeof projects !== "object" || projects === null) return seen;
    for (const key of Object.keys(projects)) {
      // No timestamp available; 1 is "seen, time unknown" and still outranks
      // never-seen repos without competing with Codex's real timestamps.
      seen.set(key, 1);
    }
  } catch {
    // Malformed file is a missing hint, not a failure.
  }
  return seen;
}

interface CodexHistory {
  byPath: Map<string, number>;
  byOrigin: Map<string, number>;
}

/**
 * Directories where Codex has been run, via the supported app-server API
 * (`thread/list`) rather than its private SQLite file. `useStateDbOnly` skips
 * the JSONL rollout scan; measured at ~190ms for 142 threads including spawn.
 *
 * `gitInfo.originUrl` matters here: a user running Codex through bb accumulates
 * many ephemeral worktree paths for a single repo, and the origin collapses
 * them into one signal.
 */
async function readCodexHistory(
  env: NodeJS.ProcessEnv,
  budgetMs: number,
): Promise<CodexHistory> {
  const byPath = new Map<string, number>();
  const byOrigin = new Map<string, number>();

  const rows = await new Promise<unknown[]>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("codex", ["app-server"], {
        env,
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      resolve([]);
      return;
    }

    const collected: unknown[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(collected);
    };
    const timer = setTimeout(finish, budgetMs);

    child.on("error", finish);
    child.on("exit", finish);

    const send = (message: unknown) => {
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        finish();
      }
    };

    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.trim()) continue;
        let message: { id?: number; result?: { data?: unknown[] } };
        try {
          message = JSON.parse(line) as typeof message;
        } catch {
          continue;
        }
        if (message.id === 1) {
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "thread/list",
            params: {
              useStateDbOnly: true,
              limit: 200,
              sortDirection: "desc",
            },
          });
        } else if (message.id === 2) {
          collected.push(...(message.result?.data ?? []));
          finish();
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "bb", title: "bb", version: "0.0.0" },
      },
    });
  });

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const thread = row as {
      cwd?: unknown;
      updatedAt?: unknown;
      gitInfo?: { originUrl?: unknown } | null;
    };
    // Codex reports seconds; everything else here is milliseconds.
    const at =
      typeof thread.updatedAt === "number" ? thread.updatedAt * 1000 : 1;
    if (typeof thread.cwd === "string" && thread.cwd.length > 0) {
      byPath.set(thread.cwd, Math.max(byPath.get(thread.cwd) ?? 0, at));
    }
    const origin = normalizeOrigin(
      typeof thread.gitInfo?.originUrl === "string"
        ? thread.gitInfo.originUrl
        : null,
    );
    if (origin) {
      byOrigin.set(origin, Math.max(byOrigin.get(origin) ?? 0, at));
    }
  }

  return { byPath, byOrigin };
}

export interface DiscoverReposArgs {
  maxDepth: number;
  sinceDays: number;
  limit: number;
  /** Injectable root for tests. */
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable recency reference for tests; operation budgets use wall time. */
  now?: number;
}

export async function discoverRepos(
  args: DiscoverReposArgs,
): Promise<DiscoverReposResult> {
  const home = args.home ?? homedir();
  const now = args.now ?? Date.now();
  const env = args.env ?? process.env;

  const { repos, truncated } = await walkForRepos(
    home,
    args.maxDepth,
    Date.now() + WALK_BUDGET_MS,
  );

  // Ranking hints are best-effort in every direction: a missing file, an
  // uninstalled `codex`, a spawn failure, or a protocol that does not know
  // `thread/list` must never fail discovery.
  const [claudeSeen, codexSeen] = await Promise.all([
    readClaudeHistory(home).catch(() => new Map<string, number>()),
    readCodexHistory(env, AGENT_HISTORY_BUDGET_MS).catch(() => ({
      byPath: new Map<string, number>(),
      byOrigin: new Map<string, number>(),
    })),
  ]);

  const cutoff = now - args.sinceDays * 86_400_000;

  /**
   * Strongest agent signal for a repo. Claude Code reports no timestamp, so a
   * hit there scores `SEEN_NO_TIME` — enough to outrank never-seen repos
   * without competing with Codex's real timestamps.
   */
  const SEEN_NO_TIME = 1;
  const agentScore = (repoPath: string, origin: string | null): number =>
    Math.max(
      claudeSeen.get(repoPath) ?? 0,
      codexSeen.byPath.get(repoPath) ?? 0,
      origin ? (codexSeen.byOrigin.get(origin) ?? 0) : 0,
    );

  const enriched = await Promise.all(
    repos.map(async (repo) => {
      const originUrl = await readOriginUrl(repo.path);
      const score = agentScore(repo.path, normalizeOrigin(originUrl));
      const entry: DiscoveredRepo = {
        path: repo.path,
        name: basename(repo.path),
        lastActivityAt: new Date(repo.lastActivityMs).toISOString(),
        originUrl,
        agentSeen: score > 0,
        agentSeenAt:
          score > SEEN_NO_TIME ? new Date(score).toISOString() : null,
      };
      return { entry, score };
    }),
  );

  // Recency filter, then rank: repos an agent has already worked in come first
  // (the strongest signal that the user wants them in bb), then local activity.
  const recent = enriched.filter(
    ({ entry }) => Date.parse(entry.lastActivityAt) >= cutoff,
  );

  recent.sort((left, right) => {
    if (left.score > 0 !== right.score > 0) return left.score > 0 ? -1 : 1;
    return (
      Date.parse(right.entry.lastActivityAt) -
      Date.parse(left.entry.lastActivityAt)
    );
  });

  return {
    repos: recent.slice(0, args.limit).map(({ entry }) => entry),
    truncated,
  };
}
