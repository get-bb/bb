import {
  ensureGitRepo,
  getCurrentBranch,
  parsePorcelainV2StatusZ,
  readDefaultBranch,
  runGit,
  type GitCommandResult,
  type GitProcessOptions,
  type RunGitOptions,
  WorkspaceError,
  isMissingHeadRevisionError,
  WORKSPACE_STATUS_GIT_TIMEOUT_MS,
} from "bb-environment-provider-host/workspace-git";
import {
  readSharedGitRefsSnapshot,
  type SharedGitRefsSnapshot,
  revParse,
} from "./git.js";
import { withCheckoutMutationLock } from "./checkout-mutation-lock.js";
import type { HostWorkspace } from "./provision.js";
import {
  resolveAdditionalWorkspaceWriteRoots,
} from "./workspace-write-roots.js";

export interface LocalStateSnapshot {
  fingerprint: string;
  branchName: string | null;
}

export interface CommitOptions {
  message: string;
  noVerify: boolean;
}

export interface CommitResult {
  commitSha: string;
  commitSubject: string;
}

export class Workspace implements HostWorkspace {
  readonly path: string;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;
  private readonly gitProcessOptions: GitProcessOptions;

  constructor(opts: {
    path: string;
    isGitRepo: boolean;
    isWorktree: boolean;
    shellPath?: string;
  }) {
    this.path = opts.path;
    this.isGitRepo = opts.isGitRepo;
    this.isWorktree = opts.isWorktree;
    this.gitProcessOptions =
      opts.shellPath === undefined ? {} : { shellPath: opts.shellPath };
  }

  private runGit(
    args: string[],
    options: RunGitOptions,
  ): Promise<GitCommandResult> {
    return runGit(args, { ...options, ...this.gitProcessOptions });
  }

  async getCurrentBranch(): Promise<string | null> {
    return (await getCurrentBranch(this.path, this.gitProcessOptions)) ?? null;
  }

  async getDefaultBranch(): Promise<string | null> {
    if (!this.isGitRepo) {
      return null;
    }
    return (
      (await readDefaultBranch(this.path, {
        timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
        ...this.gitProcessOptions,
      })) ?? null
    );
  }

  getAdditionalWorkspaceWriteRoots(): Promise<string[]> {
    if (!this.isGitRepo || !this.isWorktree) {
      return Promise.resolve([]);
    }
    return resolveAdditionalWorkspaceWriteRoots(
      this.path,
      this.gitProcessOptions,
    );
  }

  async getLocalStateSnapshot(): Promise<LocalStateSnapshot> {
    if (!this.isGitRepo)
      await ensureGitRepo(this.path, {
        timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
        ...this.gitProcessOptions,
      });
    const status = await this.runGit(
      [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=normal",
      ],
      { cwd: this.path, timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS },
    );
    const { headOid, headBranch } = parsePorcelainV2StatusZ(status.stdout);
    return {
      fingerprint: JSON.stringify({
        headSha: headOid,
        porcelain: status.stdout,
      }),
      branchName: headBranch,
    };
  }

  getSharedGitRefsSnapshot(): Promise<SharedGitRefsSnapshot> {
    return readSharedGitRefsSnapshot(
      this.path,
      this.gitProcessOptions,
      this.isGitRepo,
    );
  }

  async getHeadSha(): Promise<string | null> {
    await ensureGitRepo(this.path, this.gitProcessOptions);

    const result = await this.runGit(["rev-parse", "HEAD"], {
      allowFailure: true,
      cwd: this.path,
    });
    if (result.exitCode === 0) {
      return result.stdout.trim() || null;
    }
    if (isMissingHeadRevisionError(result.stderr)) {
      return null;
    }
    throw new WorkspaceError(
      "git_command_failed",
      `git rev-parse HEAD failed: ${result.stderr.trim()}`,
    );
  }

  async commit(options: CommitOptions): Promise<CommitResult> {
    await ensureGitRepo(this.path, this.gitProcessOptions);

    return withCheckoutMutationLock(
      this.path,
      async () => {
        await this.runGit(["add", "-A"], { cwd: this.path });
        const staged = await this.runGit(["diff", "--cached", "--quiet"], {
          cwd: this.path,
          allowFailure: true,
        });
        if (staged.exitCode === 0) {
          throw new WorkspaceError("no_changes", "No changes to commit");
        }
        const commitArgs = ["commit", "-m", options.message];
        if (options.noVerify) {
          commitArgs.push("--no-verify");
        }
        await this.runGit(commitArgs, { cwd: this.path });
        const commitSha = await revParse(
          this.path,
          "HEAD",
          this.gitProcessOptions,
        );
        const commitSubject = (
          await this.runGit(["log", "-1", "--pretty=%s"], { cwd: this.path })
        ).stdout.trim();

        return { commitSha, commitSubject };
      },
      undefined,
      this.gitProcessOptions,
    );
  }
}
