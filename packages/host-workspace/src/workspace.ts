import { isMissingHeadRevisionError } from "bb-git-host/git";
import { pathExists } from "@bb/process-utils";
import {
  getPullRequestForCurrentBranch,
  runPullRequestActionForCurrentBranch,
  type GitHostCliOptions,
  type GitHostPullRequestAction,
  type GitHostPullRequestLookup,
} from "./git-host.js";
import {
  ensureGitRepo,
  getCurrentBranch,
  revParse,
  runGit,
  type GitCommandResult,
  type GitProcessOptions,
  type RunGitOptions,
  WorkspaceError,
} from "bb-git-host/git";
import { withCheckoutMutationLock } from "./checkout-mutation-lock.js";

export interface CommitOptions {
  message: string;
  noVerify: boolean;
}

export interface CommitResult {
  commitSha: string;
  commitSubject: string;
}

export type PullRequestActionOptions = GitHostPullRequestAction;

type WorkspaceMutationWork<T> = () => Promise<T>;

const WORKSPACE_STATUS_GIT_TIMEOUT_MS = 15_000;

function parseNonEmptyLines(output: string): string[] {
  return output
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export class Workspace {
  readonly path: string;
  private readonly gitProcessOptions: GitProcessOptions;

  constructor(path: string, gitProcessOptions: GitProcessOptions = {}) {
    this.path = path;
    this.gitProcessOptions = { ...gitProcessOptions };
  }

  withMutation<T>(work: WorkspaceMutationWork<T>): Promise<T> {
    return withCheckoutMutationLock(
      this.path,
      work,
      undefined,
      this.gitProcessOptions,
    );
  }

  private runGit(
    args: string[],
    options: RunGitOptions,
  ): Promise<GitCommandResult> {
    return runGit(args, { ...options, ...this.gitProcessOptions });
  }

  get exists(): Promise<boolean> {
    return pathExists(this.path);
  }

  get currentBranch(): Promise<string | undefined> {
    return getCurrentBranch(this.path, this.gitProcessOptions);
  }

  async getPullRequest(
    options: GitHostCliOptions = {},
  ): Promise<GitHostPullRequestLookup> {
    if (!(await this.exists)) {
      return {
        outcome: "unavailable",
        message: `Workspace path no longer exists: ${this.path}`,
      };
    }
    const branch = await getCurrentBranch(this.path, this.gitProcessOptions);
    if (!branch) {
      return { outcome: "none" };
    }
    return getPullRequestForCurrentBranch({
      cwd: this.path,
      localBranch: branch,
      ...this.gitProcessOptions,
      ...options,
    });
  }

  async runPullRequestAction(
    action: PullRequestActionOptions,
    options: GitHostCliOptions = {},
  ): Promise<void> {
    const branch = await getCurrentBranch(this.path, this.gitProcessOptions);
    if (!branch) {
      throw new WorkspaceError(
        "invalid_request",
        "Cannot update pull request from a detached workspace",
      );
    }
    return runPullRequestActionForCurrentBranch({
      cwd: this.path,
      localBranch: branch,
      action,
      ...this.gitProcessOptions,
      ...options,
    });
  }

  async getLocalStateFingerprint(): Promise<string> {
    await ensureGitRepo(this.path, {
      timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
      ...this.gitProcessOptions,
    });
    const [headSha, status] = await Promise.all([
      this.getHeadSha(),
      this.runGit(
        [
          "--no-optional-locks",
          "status",
          "--porcelain=v1",
          "--branch",
          "--untracked-files=normal",
        ],
        { cwd: this.path, timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS },
      ),
    ]);
    return JSON.stringify({
      headSha,
      porcelain: status.stdout,
    });
  }

  async getSharedGitRefsFingerprint(): Promise<string> {
    await ensureGitRepo(this.path, this.gitProcessOptions);

    const [refs, remoteHead] = await Promise.all([
      this.runGit(
        [
          "for-each-ref",
          "--format=%(refname)%00%(objectname)",
          "refs/heads",
          "refs/remotes",
        ],
        { cwd: this.path },
      ),
      this.runGit(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], {
        cwd: this.path,
        allowFailure: true,
      }),
    ]);

    return JSON.stringify({
      refs: parseNonEmptyLines(refs.stdout),
      remoteHead: remoteHead.exitCode === 0 ? remoteHead.stdout.trim() : "",
    });
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

    return this.withMutation(async () => {
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
    });
  }
}
