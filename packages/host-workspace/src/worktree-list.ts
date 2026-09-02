import fs from "node:fs/promises";
import path from "node:path";
import {
  WORKTREE_COMPARISON_PATHS_MAX,
  type GitWorktreeEntry,
  type ResolvedHostPath,
} from "@bb/domain";
import {
  WorkspaceError,
  detectGitRepoKind,
  pathExists,
  runGit,
  type GitProcessOptions,
} from "./git.js";

/**
 * Discovery must return quickly and completely: a hung git process or an
 * output overflow fails the call instead of producing a truncated list that
 * would read as "these are all the worktrees".
 */
const WORKTREE_LIST_TIMEOUT_MS = 10_000;
const WORKTREE_LIST_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export interface ListGitWorktreesOptions extends GitProcessOptions {
  timeoutMs?: number;
  maxBufferBytes?: number;
}

/** A parsed porcelain record before this host resolves its canonical path. */
export type ParsedGitWorktreeEntry = Omit<GitWorktreeEntry, "canonicalPath">;

interface RawWorktreeRecord {
  path: string;
  headSha: string | null;
  branchRef: string | null;
  bare: boolean;
  detached: boolean;
  lock: { reason: string | null } | null;
  prunable: { reason: string | null } | null;
}

function malformedOutputError(detail: string): WorkspaceError {
  return new WorkspaceError(
    "worktree_list_malformed",
    `Unexpected git worktree list output: ${detail}`,
  );
}

function finalizeRecord(record: RawWorktreeRecord): ParsedGitWorktreeEntry {
  if (record.path.length === 0) {
    throw malformedOutputError("worktree record has an empty path");
  }
  const checkout = ((): ParsedGitWorktreeEntry["checkout"] => {
    if (record.bare) {
      return { kind: "bare" };
    }
    if (record.detached) {
      if (record.headSha === null || record.headSha.length === 0) {
        throw malformedOutputError(
          `detached worktree record has no HEAD: ${record.path}`,
        );
      }
      return { kind: "detached", headSha: record.headSha };
    }
    if (record.branchRef !== null) {
      const branchName = record.branchRef.startsWith("refs/heads/")
        ? record.branchRef.slice("refs/heads/".length)
        : record.branchRef;
      if (branchName.length === 0) {
        throw malformedOutputError(
          `worktree record has an empty branch ref: ${record.path}`,
        );
      }
      return { kind: "branch", branchName };
    }
    throw malformedOutputError(
      `worktree record has no branch, detached, or bare marker: ${record.path}`,
    );
  })();
  return {
    path: record.path,
    checkout,
    lock: record.lock,
    prunable: record.prunable,
  };
}

/**
 * Parses NUL-delimited `git worktree list --porcelain -z` output. Each
 * attribute is NUL-terminated and each record ends with one extra NUL, so
 * paths and lock/prunable reasons keep spaces and newlines intact. Unknown
 * attribute labels are tolerated for forward compatibility; a structurally
 * broken or truncated record is an error, never a silently dropped row.
 */
export function parseGitWorktreeListOutput(
  output: string,
): ParsedGitWorktreeEntry[] {
  const entries: ParsedGitWorktreeEntry[] = [];
  let current: RawWorktreeRecord | null = null;
  for (const token of output.split("\0")) {
    if (token === "") {
      if (current !== null) {
        entries.push(finalizeRecord(current));
        current = null;
      }
      continue;
    }
    const spaceIndex = token.indexOf(" ");
    const label = spaceIndex === -1 ? token : token.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? null : token.slice(spaceIndex + 1);
    if (label === "worktree") {
      if (current !== null) {
        throw malformedOutputError(
          `worktree attribute before the previous record ended: ${token}`,
        );
      }
      current = {
        path: value ?? "",
        headSha: null,
        branchRef: null,
        bare: false,
        detached: false,
        lock: null,
        prunable: null,
      };
      continue;
    }
    if (current === null) {
      throw malformedOutputError(
        `attribute before any worktree path: ${token}`,
      );
    }
    switch (label) {
      case "HEAD":
        current.headSha = value;
        break;
      case "branch":
        current.branchRef = value;
        break;
      case "bare":
        current.bare = true;
        break;
      case "detached":
        current.detached = true;
        break;
      case "locked":
        current.lock = { reason: value };
        break;
      case "prunable":
        current.prunable = { reason: value };
        break;
      default:
        break;
    }
  }
  if (current !== null) {
    throw malformedOutputError("output ended inside a worktree record");
  }
  return entries;
}

async function realpathOrNull(targetPath: string): Promise<string | null> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return null;
  }
}

/**
 * Lists every worktree registered with the git repository at `sourcePath`,
 * including the source checkout itself, with canonical (realpath) identities
 * resolved on this host. A registration whose directory is gone stays in the
 * result with `canonicalPath: null`; only a failed git invocation, a timeout,
 * an output overflow, or malformed output rejects.
 */
export async function listGitWorktrees(
  sourcePath: string,
  options: ListGitWorktreesOptions = {},
): Promise<GitWorktreeEntry[]> {
  if (!path.isAbsolute(sourcePath)) {
    throw new WorkspaceError(
      "invalid_request",
      `Worktree discovery requires an absolute path: ${sourcePath}`,
    );
  }
  const {
    timeoutMs = WORKTREE_LIST_TIMEOUT_MS,
    maxBufferBytes = WORKTREE_LIST_MAX_BUFFER_BYTES,
    ...processOptions
  } = options;
  if (!(await pathExists(sourcePath))) {
    throw new WorkspaceError(
      "path_not_found",
      `Path does not exist: ${sourcePath}`,
    );
  }
  const repoKind = await detectGitRepoKind(sourcePath, {
    ...processOptions,
    timeoutMs,
  });
  if (repoKind === "none") {
    throw new WorkspaceError(
      "not_git_repo",
      `Path is not a git repository: ${sourcePath}`,
    );
  }
  const result = await runGit(["worktree", "list", "--porcelain", "-z"], {
    cwd: sourcePath,
    ...processOptions,
    timeoutMs,
    maxBufferBytes,
  });
  const parsed = parseGitWorktreeListOutput(result.stdout);
  return Promise.all(
    parsed.map(async (entry) => ({
      ...entry,
      canonicalPath: await realpathOrNull(entry.path),
    })),
  );
}

/**
 * Resolves stored environment paths to canonical identities on this host so
 * the server can compare them with discovered worktrees. Canonicalization
 * must happen here: for a remote host the server cannot realpath these paths
 * itself. A missing path is data (`canonicalPath: null`), not an error.
 */
export async function resolveHostPaths(
  paths: readonly string[],
): Promise<ResolvedHostPath[]> {
  if (paths.length > WORKTREE_COMPARISON_PATHS_MAX) {
    throw new WorkspaceError(
      "invalid_request",
      `Too many comparison paths: ${paths.length} exceeds ${WORKTREE_COMPARISON_PATHS_MAX}`,
    );
  }
  return Promise.all(
    paths.map(async (candidate) => {
      if (!path.isAbsolute(candidate)) {
        throw new WorkspaceError(
          "invalid_request",
          `Comparison paths must be absolute: ${candidate}`,
        );
      }
      return {
        path: candidate,
        canonicalPath: await realpathOrNull(candidate),
      };
    }),
  );
}
