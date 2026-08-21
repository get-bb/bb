import { execFile, type ExecFileException } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import { WorkspaceError } from "./git.js";
import {
  withProcessLocalQueuedLocks,
  type ProcessLocalQueuedLockWork,
} from "./process-local-queued-lock.js";

const execFileAsync = promisify(execFile);
const DEFAULT_BUFFER_BYTES = 16 * 1024 * 1024;

export interface RunJjOptions {
  cwd: string;
  timeoutMs?: number;
  allowFailure?: boolean;
  signal?: AbortSignal;
}

export interface JjCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs jj with a non-interactive, machine-readable configuration. `--no-pager`
 * and `--color=never` keep stdout parseable; `--quiet` is deliberately not
 * passed because several commands report their outcome on stdout.
 *
 * Note that most jj commands snapshot the working copy as a side effect. Pass
 * `--ignore-working-copy` in the caller when a read must not write.
 */
export async function runJj(
  args: string[],
  options: RunJjOptions,
): Promise<JjCommandResult> {
  const fullArgs = ["--no-pager", "--color=never", ...args];
  try {
    const result = await execFileAsync("jj", fullArgs, {
      cwd: options.cwd,
      encoding: "utf8",
      env: sanitizeInheritedChildProcessEnv({ env: process.env }),
      maxBuffer: DEFAULT_BUFFER_BYTES,
      signal: options.signal,
      timeout: options.timeoutMs,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const execError =
      error instanceof Error ? (error as ExecFileException) : undefined;
    if (options.signal?.aborted) {
      throw new WorkspaceError(
        "provision_cancelled",
        `jj ${args.join(" ")} was cancelled`,
        { cause: error },
      );
    }
    if (
      options.timeoutMs !== undefined &&
      execError?.killed === true &&
      execError.signal === "SIGTERM"
    ) {
      throw new WorkspaceError(
        "jj_command_timeout",
        `jj ${args.join(" ")} timed out after ${options.timeoutMs}ms`,
        { cause: error },
      );
    }
    if (options.allowFailure) {
      return {
        stdout: execError?.stdout ?? "",
        stderr: execError?.stderr ?? "",
        exitCode: typeof execError?.code === "number" ? execError.code : 1,
      };
    }

    const stderr = (execError?.stderr ?? "").trim();
    throw new WorkspaceError(
      "jj_command_failed",
      `jj ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`,
      { cause: error },
    );
  }
}

export interface JjWorkspaceLayout {
  /**
   * `main` is the workspace the repo was initialized in. Colocated repos keep
   * a real `.git` beside `.jj` there. `secondary` is a `jj workspace add`
   * workspace: it has no `.git` at all, so every git command has to run in the
   * source repo instead.
   */
  kind: "main" | "secondary";
  /** Absolute path to the `.jj/repo` directory that backs this workspace. */
  repoPath: string;
  /** Absolute path to the repository root that owns `.jj/repo`. */
  sourcePath: string;
}

/**
 * Resolves the jj layout of a directory, or null when it is not inside a jj
 * workspace root.
 *
 * A main workspace has `.jj/repo` as a directory. A secondary workspace has
 * `.jj/repo` as a file holding a path to the main workspace's `.jj/repo`,
 * which jj writes relative to the `.jj` directory that contains it.
 */
export async function resolveJjWorkspaceLayout(
  cwd: string,
): Promise<JjWorkspaceLayout | null> {
  const jjDir = path.join(cwd, ".jj");
  const repoEntry = path.join(jjDir, "repo");
  let stats;
  try {
    stats = await fs.lstat(repoEntry);
  } catch {
    return null;
  }

  if (stats.isDirectory()) {
    return { kind: "main", repoPath: repoEntry, sourcePath: path.resolve(cwd) };
  }
  if (!stats.isFile()) {
    return null;
  }

  const pointer = (await fs.readFile(repoEntry, "utf8")).trim();
  if (!pointer) {
    return null;
  }
  const repoPath = path.resolve(jjDir, pointer);
  return {
    kind: "secondary",
    repoPath,
    // <sourcePath>/.jj/repo -> <sourcePath>
    sourcePath: path.resolve(repoPath, "..", ".."),
  };
}

/**
 * True for a source repository bb can provision jj workspaces from: a jj main
 * workspace colocated with a real git repository. The colocated `.git` is what
 * lets bb keep reading diffs, merge bases and blobs with git.
 */
export async function detectColocatedJjSource(cwd: string): Promise<boolean> {
  const layout = await resolveJjWorkspaceLayout(cwd);
  if (layout?.kind !== "main") {
    return false;
  }
  try {
    return (await fs.lstat(path.join(cwd, ".git"))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Serializes jj mutations against one repository. jj takes its own lock on the
 * repo, so this only avoids pile-ups and keeps bb's own sequences (commit ->
 * bookmark set -> git export) atomic with respect to each other.
 */
export async function withJjRepoLock<T>(
  layout: JjWorkspaceLayout,
  work: ProcessLocalQueuedLockWork<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withProcessLocalQueuedLocks({
    locks: [{ key: `jj-repo:${layout.repoPath}` }],
    signal,
    work,
  });
}
