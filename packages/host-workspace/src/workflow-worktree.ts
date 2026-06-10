import {
  getGitCommonDir,
  hasUncommittedChanges,
  revParse,
  runGit,
} from "./git.js";
import { createWorktree, removeWorktree } from "./provisioning.js";
import {
  runGitWithWorktreeMetadataLock,
  withWorktreeMetadataLock,
} from "./worktree-metadata-lock.js";

/**
 * Per-worktree git config key recording the commit a workflow worktree was
 * branched from at creation. Stored in the worktree's own `config.worktree`
 * (via `extensions.worktreeConfig`) so parallel workflow worktrees created at
 * different base commits never clobber each other, and so honest teardown
 * survives daemon restarts: the recorded base — not a re-read of the source
 * HEAD — decides clean-vs-dirty. Re-reading HEAD at teardown would be wrong:
 * if the source branch advanced, an agent's committed work would show
 * zero-ahead and be force-deleted.
 */
const WORKFLOW_WORKTREE_BASE_CONFIG_KEY = "bb.workflowWorktreeBase";

export interface ProvisionWorkflowWorktreeArgs {
  /**
   * Repo checkout the worktree branches from. The creation base is this
   * checkout's HEAD at provision time.
   */
  sourcePath: string;
  targetPath: string;
  runId: string;
  /** The runtime's journal-stable display index for the logical agent. */
  agentIndex: number;
  /**
   * 0-based attempt of the agent run. Retries get a `-r<attempt>` branch
   * suffix so a branch preserved by a prior dirty attempt never blocks
   * re-provisioning the same logical agent.
   */
  attempt: number;
  /** Timeout for the worktree's `.bb-env-setup.sh`, when present. */
  setupTimeoutMs: number;
  signal?: AbortSignal;
}

export interface WorkflowWorktree {
  path: string;
  branch: string;
}

export interface TeardownWorkflowWorktreeArgs {
  /** Repo checkout the worktree was provisioned from (for branch deletion). */
  sourcePath: string;
  worktree: WorkflowWorktree;
}

export type WorkflowWorktreeTeardownResult =
  | { removed: true }
  | { removed: false; preservedBranch: string };

function workflowWorktreeBranchName(args: {
  runId: string;
  agentIndex: number;
  attempt: number;
}): string {
  const base = `wf/${args.runId}-${args.agentIndex}`;
  return args.attempt === 0 ? base : `${base}-r${args.attempt}`;
}

/**
 * Provision a fresh worktree for a workflow agent on branch
 * `wf/<runId>-<index>` (`-r<attempt>` suffix on retries), based on the source
 * checkout's current HEAD.
 *
 * Fresh-start semantics: a crashed prior attempt can leave the target
 * directory and/or a stale missing-directory worktree registration behind,
 * either of which makes `git worktree add` fail forever. Both are cleared
 * before adding — a resumed agent re-derives its work from the run journal,
 * so stale partial state must never leak into the new attempt. The creation
 * base commit is recorded in the worktree's own config (see
 * {@link WORKFLOW_WORKTREE_BASE_CONFIG_KEY}) and `.bb-env-setup.sh` runs like
 * any managed bb worktree (creation rolls back if it fails).
 */
export async function provisionWorkflowWorktree(
  args: ProvisionWorkflowWorktreeArgs,
): Promise<WorkflowWorktree> {
  const branch = workflowWorktreeBranchName(args);
  const baseCommit = await revParse(args.sourcePath, "HEAD");

  await removeWorktree({ path: args.targetPath, force: true });
  // removeWorktree no-ops when the directory is already gone, so a stale
  // registration from a crashed attempt can survive it; prune clears those.
  await runGitWithWorktreeMetadataLock(["worktree", "prune"], {
    cwd: args.sourcePath,
    signal: args.signal,
  });

  await createWorktree({
    sourcePath: args.sourcePath,
    targetPath: args.targetPath,
    branchName: branch,
    baseBranch: baseCommit,
    timeoutMs: args.setupTimeoutMs,
    signal: args.signal,
  });

  try {
    await recordBaseCommit({
      worktreePath: args.targetPath,
      baseCommit,
      signal: args.signal,
    });
  } catch (error) {
    // Nothing of value exists yet; mirror createWorktree's own rollback so a
    // failed provision never leaves a half-configured worktree behind.
    await removeWorktree({ path: args.targetPath, force: true });
    throw error;
  }

  return { path: args.targetPath, branch };
}

async function recordBaseCommit(args: {
  worktreePath: string;
  baseCommit: string;
  signal?: AbortSignal;
}): Promise<void> {
  const commonDir = await getGitCommonDir(args.worktreePath);
  // Enabling extensions.worktreeConfig writes the shared config file; take the
  // worktree metadata lock so parallel provisions don't race on config.lock.
  await withWorktreeMetadataLock(
    commonDir,
    async () => {
      // Without the extension, `git config --worktree` silently degrades to
      // `--local` (the shared config) on some git versions — enable it
      // explicitly so the write below is always per-worktree. Skip the write
      // when it is already set: the rewrite takes the shared config.lock on
      // every provision, the hottest half of the M7-soak-diagnosed race.
      const existing = await runGit(
        ["config", "--get", "extensions.worktreeConfig"],
        { cwd: args.worktreePath, allowFailure: true, signal: args.signal },
      );
      if (existing.exitCode !== 0 || existing.stdout.trim() !== "true") {
        await runGit(["config", "extensions.worktreeConfig", "true"], {
          cwd: args.worktreePath,
          signal: args.signal,
        });
      }
      await runGit(
        [
          "config",
          "--worktree",
          WORKFLOW_WORKTREE_BASE_CONFIG_KEY,
          args.baseCommit,
        ],
        { cwd: args.worktreePath, signal: args.signal },
      );
    },
    args.signal,
  );
}

async function readRecordedBaseCommit(
  worktreePath: string,
): Promise<string | null> {
  const result = await runGit(
    ["config", "--worktree", "--get", WORKFLOW_WORKTREE_BASE_CONFIG_KEY],
    { cwd: worktreePath, allowFailure: true },
  );
  if (result.exitCode !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

/**
 * Tear down a workflow worktree with clean-vs-dirty semantics: auto-remove
 * (worktree and branch) only when the agent provably changed nothing since
 * the recorded creation base; preserve the branch on any change or any doubt
 * (missing/unreadable base record, failed status or rev-list, missing
 * directory). Never throws — teardown runs in agent-settle finally blocks and
 * must not mask agent results.
 */
export async function teardownWorkflowWorktree(
  args: TeardownWorkflowWorktreeArgs,
): Promise<WorkflowWorktreeTeardownResult> {
  const { sourcePath, worktree } = args;

  // changed === true means preserve. Default to dirty; only a fully
  // successful clean check flips it.
  let changed = true;
  try {
    const baseCommit = await readRecordedBaseCommit(worktree.path);
    if (baseCommit !== null) {
      const dirty = await hasUncommittedChanges(worktree.path);
      const ahead = await runGit(
        ["rev-list", "--count", `${baseCommit}..HEAD`],
        { cwd: worktree.path },
      );
      changed = dirty || ahead.stdout.trim() !== "0";
    }
  } catch {
    changed = true;
  }

  if (changed) {
    return { removed: false, preservedBranch: worktree.branch };
  }

  try {
    await removeWorktree({ path: worktree.path, force: true });
    // Best-effort: the clean check above proved the branch holds no work, so
    // a leftover ref (e.g. a stale registration still pinning it) is harmless
    // and the next provision's prune clears the registration. Runs under the
    // worktree metadata lock: `branch -D` rewrites `branch.*` sections in the
    // shared `.git/config` via config.lock, racing recordBaseCommit's shared
    // write from a parallel provision (the M7-soak-diagnosed ~1-in-90
    // provisioning failure when unlocked).
    await runGitWithWorktreeMetadataLock(["branch", "-D", worktree.branch], {
      cwd: sourcePath,
      allowFailure: true,
    });
    return { removed: true };
  } catch {
    return { removed: false, preservedBranch: worktree.branch };
  }
}
