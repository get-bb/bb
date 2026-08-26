import { execFile, type ExecFileException } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import { WorkspaceError, runGit, type GitProcessOptions } from "./git.js";
import {
  withProcessLocalQueuedLocks,
  type ProcessLocalQueuedLockWork,
} from "./process-local-queued-lock.js";

const execFileAsync = promisify(execFile);
const DEFAULT_BUFFER_BYTES = 16 * 1024 * 1024;

export interface RunJjOptions extends GitProcessOptions {
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
      env: sanitizeInheritedChildProcessEnv({
        env: process.env,
        ...(options.shellPath !== undefined
          ? { shellPath: options.shellPath }
          : {}),
      }),
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
 * Commit ids of the working-copy commit and its first parent.
 *
 * Reading these snapshots the working copy, which is what makes the edits on
 * disk visible to everything downstream. `@` is the working copy, `@-` is what
 * git calls HEAD. A merge working copy has several parents; bb follows the
 * first one, matching how git reports a merge checkout.
 */
export interface JjWorkingCopyCommits {
  at: string;
  parent: string;
}

export async function readJjWorkingCopyCommits(
  cwd: string,
  options: GitProcessOptions & { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<JjWorkingCopyCommits> {
  const result = await runJj(
    [
      "log",
      "--no-graph",
      "-r",
      "@",
      "-T",
      'commit_id ++ "\\n" ++ parents.map(|parent| parent.commit_id()).join(" ") ++ "\\n"',
    ],
    { cwd, timeoutMs: options.timeoutMs, signal: options.signal },
  );
  const [at = "", parents = ""] = result.stdout.split("\n");
  const parent = parents.trim().split(" ")[0] ?? "";
  if (!at || !parent) {
    throw new WorkspaceError(
      "jj_command_failed",
      "jj log did not report the working-copy commit and its parent",
    );
  }
  return { at, parent };
}

/**
 * Points the workspace's shadow git checkout at jj's `@-` and rebuilds its
 * index from that commit.
 *
 * bb provisions a jj workspace with a git worktree registration beside it (see
 * `attachShadowGitCheckout`) so every git-based read keeps working. jj knows
 * nothing about that registration, so whenever jj moves `@-` — bb's own commit,
 * or an agent running jj directly — git's HEAD and index have to be pulled
 * along before anything reads them. `reset` moves both without touching a file
 * in the working tree, so jj stays the only writer of the checkout itself.
 */
export async function syncShadowGitCheckout(
  workspacePath: string,
  options: GitProcessOptions & { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const { parent } = await readJjWorkingCopyCommits(workspacePath, options);
  const head = await runGit(["rev-parse", "HEAD"], {
    cwd: workspacePath,
    allowFailure: true,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  if (head.exitCode === 0 && head.stdout.trim() === parent) {
    return;
  }
  await runGit(["reset", "-q", parent], {
    cwd: workspacePath,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}

/**
 * Name jj knows a workspace directory by, or null when the repository has no
 * workspace rooted there.
 *
 * Workspaces are matched on the root path jj records rather than on a name bb
 * remembers, so this also resolves after a restart, and for workspaces bb did
 * not create.
 */
export async function readJjWorkspaceName(
  sourcePath: string,
  workspacePath: string,
  options: GitProcessOptions = {},
): Promise<string | null> {
  const listed = await runJj(
    ["workspace", "list", "-T", 'name ++ "\\t" ++ if(root, root, "") ++ "\\n"'],
    { cwd: sourcePath, allowFailure: true, ...options },
  );
  if (listed.exitCode !== 0) {
    return null;
  }

  const target = path.resolve(workspacePath);
  for (const line of listed.stdout.split("\n")) {
    const [name = "", root = ""] = line.split("\t");
    if (name && root && path.resolve(root) === target) {
      return name;
    }
  }
  return null;
}

/**
 * Registers an existing jj workspace as a git worktree of its source
 * repository, so bb reads it with the same git commands it uses everywhere
 * else.
 *
 * `git worktree add` insists on an empty directory and jj has already filled
 * this one, so the registration is created next to it and then moved in:
 * `worktree repair` rewrites both ends of the pointer pair afterwards. The
 * checkout ends up detached at `@-`, which is the same shape jj leaves behind
 * in a colocated main workspace.
 */
export async function attachShadowGitCheckout(
  args: GitProcessOptions & {
    sourcePath: string;
    workspacePath: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<void> {
  const { sourcePath, workspacePath } = args;
  const gitOptions = {
    timeoutMs: args.timeoutMs,
    signal: args.signal,
    ...(args.shellPath !== undefined ? { shellPath: args.shellPath } : {}),
  };
  // jj writes this for colocated main workspaces but not for the ones it adds;
  // without it git reports the whole .jj directory as untracked.
  await fs.writeFile(path.join(workspacePath, ".jj", ".gitignore"), "/*\n", "utf8");

  const stagingParent = await fs.mkdtemp(path.join(os.tmpdir(), "bb-jj-git-"));
  // git names the registration after the destination's basename; keeping the
  // same basename here keeps `git worktree list` readable.
  const stagingPath = path.join(stagingParent, path.basename(workspacePath));
  try {
    const { parent } = await readJjWorkingCopyCommits(workspacePath, gitOptions);
    await runGit(
      ["worktree", "add", "--detach", "--no-checkout", stagingPath, parent],
      { cwd: sourcePath, ...gitOptions },
    );
    await fs.rename(
      path.join(stagingPath, ".git"),
      path.join(workspacePath, ".git"),
    );
    await runGit(["worktree", "repair"], { cwd: workspacePath, ...gitOptions });
    // --no-checkout left the index empty; reset fills it from @- without
    // touching the files jj checked out.
    await runGit(["reset", "-q", parent], { cwd: workspacePath, ...gitOptions });
  } finally {
    await fs.rm(stagingParent, { recursive: true, force: true });
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
