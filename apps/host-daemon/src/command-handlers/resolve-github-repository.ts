import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, normalize } from "node:path";
import { promisify } from "node:util";
import type {
  ResolveGithubRepositoryResult,
  ResolvedGithubRepository,
} from "@bb/host-daemon-contract";
import { runGit } from "@bb/host-workspace";
import { discoverRepos, readOriginUrl } from "./discover-repos.js";

const execFileAsync = promisify(execFile);
const GITHUB_FULL_NAME = /^([^/\s]+)\/([^/\s]+)$/u;
const GITHUB_API_TIMEOUT_MS = 8_000;
const GIT_REMOTE_TIMEOUT_MS = 2_000;

export type ResolveGithubFullName = (
  providerRepositoryId: string,
  env: NodeJS.ProcessEnv,
) => Promise<string | null>;

export interface ResolveGithubRepositoryArgs {
  providerRepositoryId: string;
  knownPaths: readonly string[];
  dataDir: string;
  /** Injectable for tests. */
  home?: string;
  env?: NodeJS.ProcessEnv;
  resolveFullName?: ResolveGithubFullName;
  discover?: typeof discoverRepos;
}

const UNAVAILABLE = Object.freeze({ outcome: "unavailable" as const });
const CONFIRMED_MISS = Object.freeze({ outcome: "not_found" as const });

/**
 * Collapse `git@github.com:o/r.git` and `https://github.com/o/r` to
 * `owner/repo` (lowercase). Non-GitHub remotes do not match a GitHub id.
 */
export function githubNwoFromRemote(url: string): string | null {
  const withoutGit = url
    .trim()
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "");
  const ssh = /^git@github\.com(?:-[^:]+)?:([^/]+)\/([^/]+)$/iu.exec(
    withoutGit,
  );
  if (ssh?.[1] && ssh[2]) {
    return `${ssh[1]}/${ssh[2]}`.toLowerCase();
  }
  try {
    const parsed = new URL(withoutGit);
    if (!["git:", "http:", "https:", "ssh:"].includes(parsed.protocol)) {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "github.com" && !hostname.startsWith("github.com-")) {
      return null;
    }
    const match = /^\/([^/]+)\/([^/]+)$/u.exec(parsed.pathname);
    if (match?.[1] && match[2]) {
      return `${match[1]}/${match[2]}`.toLowerCase();
    }
  } catch {
    return null;
  }
  return null;
}

export function parseGithubFullName(raw: string): string | null {
  const match = GITHUB_FULL_NAME.exec(raw.trim());
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return `${match[1]}/${match[2]}`.toLowerCase();
}

async function resolveFullNameViaGh(
  providerRepositoryId: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["api", `/repositories/${providerRepositoryId}`, "--jq", ".full_name"],
      { env, encoding: "utf8", timeout: GITHUB_API_TIMEOUT_MS },
    );
    return parseGithubFullName(stdout);
  } catch {
    return null;
  }
}

async function resolveFullNameViaApi(
  providerRepositoryId: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    const token = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "bb-host-daemon",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(
      `https://api.github.com/repositories/${providerRepositoryId}`,
      {
        headers,
        signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("full_name" in body) ||
      typeof body.full_name !== "string"
    ) {
      return null;
    }
    return parseGithubFullName(body.full_name);
  } catch {
    return null;
  }
}

export async function defaultResolveGithubFullName(
  providerRepositoryId: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  return (
    (await resolveFullNameViaGh(providerRepositoryId, env)) ??
    (await resolveFullNameViaApi(providerRepositoryId, env))
  );
}

function usableAbsolutePath(value: string): string | null {
  if (
    !isAbsolute(value) ||
    value === "/" ||
    normalize(value) !== value ||
    value !== value.trim()
  ) {
    return null;
  }
  return value;
}

function uniqueAbsolutePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of paths) {
    const path = usableAbsolutePath(value);
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }
  return unique;
}

interface PathSearchResult {
  complete: boolean;
  repository: ResolvedGithubRepository | null;
}

type RepositoryCandidate = ResolvedGithubRepository & { originUrl: string };

function isFileSystemErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function listExistingCheckoutPaths(
  dataDir: string,
): Promise<{ complete: boolean; paths: string[] }> {
  const root = join(dataDir, "checkouts");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const paths = entries
      .filter(
        (entry) =>
          (entry.isDirectory() || entry.isSymbolicLink()) &&
          !entry.name.startsWith("."),
      )
      .map((entry) => join(root, entry.name))
      .sort();
    return { complete: true, paths };
  } catch (error) {
    return isFileSystemErrorWithCode(error, "ENOENT")
      ? { complete: true, paths: [] }
      : { complete: false, paths: [] };
  }
}

async function repositoryAtPath(
  repoPath: string,
): Promise<
  | { outcome: "found"; repository: RepositoryCandidate }
  | { outcome: "not_found" }
  | { outcome: "unavailable" }
> {
  try {
    await lstat(join(repoPath, ".git"));
  } catch (error) {
    return isFileSystemErrorWithCode(error, "ENOENT")
      ? { outcome: "not_found" }
      : { outcome: "unavailable" };
  }

  const fromConfig = await readOriginUrl(repoPath);
  if (fromConfig !== null) {
    return {
      outcome: "found",
      repository: {
        path: repoPath,
        name: basename(repoPath),
        originUrl: fromConfig,
      },
    };
  }

  try {
    const result = await runGit(["remote", "get-url", "origin"], {
      cwd: repoPath,
      allowFailure: true,
      timeoutMs: GIT_REMOTE_TIMEOUT_MS,
    });
    if (result.exitCode === 2) return { outcome: "not_found" };
    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      return { outcome: "unavailable" };
    }
    return {
      outcome: "found",
      repository: {
        path: repoPath,
        name: basename(repoPath),
        originUrl: result.stdout.trim(),
      },
    };
  } catch {
    return { outcome: "unavailable" };
  }
}

async function firstMatchingRepository(
  paths: readonly string[],
  nwo: string,
): Promise<PathSearchResult> {
  let complete = true;
  for (const repoPath of [...new Set(paths)].sort()) {
    const result = await repositoryAtPath(repoPath);
    if (result.outcome === "unavailable") {
      complete = false;
      continue;
    }
    if (result.outcome === "not_found") continue;
    if (githubNwoFromRemote(result.repository.originUrl) !== nwo) continue;
    return {
      complete,
      repository: {
        path: result.repository.path,
        name: result.repository.name,
      },
    };
  }
  return { complete, repository: null };
}

/**
 * Map a numeric GitHub repository id to a checkout that already exists on
 * this host. Never invents a path: it only inspects known BB project paths,
 * existing `{dataDir}/checkouts/*` directories, then a home-directory walk.
 */
export async function resolveGithubRepository(
  args: ResolveGithubRepositoryArgs,
): Promise<ResolveGithubRepositoryResult> {
  const env = args.env ?? process.env;
  const resolveFullName = args.resolveFullName ?? defaultResolveGithubFullName;
  const nwo = await resolveFullName(args.providerRepositoryId, env);
  if (nwo === null) return UNAVAILABLE;

  const knownSearch = await firstMatchingRepository(
    uniqueAbsolutePaths(args.knownPaths),
    nwo,
  );
  if (knownSearch.repository !== null) {
    return { outcome: "found", repository: knownSearch.repository };
  }

  const checkouts = await listExistingCheckoutPaths(args.dataDir);
  const checkoutSearch = await firstMatchingRepository(checkouts.paths, nwo);
  if (checkoutSearch.repository !== null) {
    return { outcome: "found", repository: checkoutSearch.repository };
  }

  const discovered = await (args.discover ?? discoverRepos)({
    maxDepth: Number.MAX_SAFE_INTEGER,
    sinceDays: Number.POSITIVE_INFINITY,
    limit: Number.MAX_SAFE_INTEGER,
    includeAgentHistory: false,
    home: args.home ?? homedir(),
    env,
  });
  const discoveredSearch = await firstMatchingRepository(
    discovered.repos.map((repo) => repo.path),
    nwo,
  );
  if (discoveredSearch.repository !== null) {
    return { outcome: "found", repository: discoveredSearch.repository };
  }
  return knownSearch.complete &&
    checkouts.complete &&
    checkoutSearch.complete &&
    !discovered.truncated &&
    discoveredSearch.complete
    ? CONFIRMED_MISS
    : UNAVAILABLE;
}
