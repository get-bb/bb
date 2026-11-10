import {
  WorkspaceError,
  type GitCommandResult,
  type GitProcessOptions,
  type GitTimeoutOptions,
  type DefaultBranchRefs,
  type GitRepo,
  createGitQueries,
  pathExists,
  runGit as runSharedGit,
  trimOutput,
} from "./workspace-git.js";
export { pathExists, WorkspaceError };
export type { GitCommandResult, GitProcessOptions, DefaultBranchRefs, GitRepo };

export interface RunGitOptions extends GitProcessOptions {
  cwd: string;
  timeoutMs?: number;
  allowFailure?: boolean;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  input?: string;
}

type GitRepositoryState = "not_git" | "no_commits" | "has_commits";

export function runGit(
  args: string[],
  options: RunGitOptions,
): Promise<GitCommandResult> {
  return runSharedGit(args, { ...options, priority: "background" });
}

export async function readGitRepositoryState(
  cwd: string,
  options: GitTimeoutOptions = {},
): Promise<GitRepositoryState> {
  if (!(await detectGitSource(cwd, options))) {
    return "not_git";
  }
  const head = await runGit(
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    {
      cwd,
      ...options,
      allowFailure: true,
    },
  );
  if (head.exitCode === 0) {
    return "has_commits";
  }
  const result = await runGit(["rev-list", "--all", "--max-count=1"], {
    cwd,
    ...options,
  });
  return trimOutput(result.stdout).length > 0 ? "has_commits" : "no_commits";
}

export async function findWorktreeForBranch(
  cwd: string,
  branchName: string,
  options: GitTimeoutOptions = {},
): Promise<string | null> {
  await ensureGitRepo(cwd, options);
  const result = await runGit(["worktree", "list", "--porcelain"], {
    cwd,
    ...options,
  });
  let worktreePath: string | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice("worktree ".length);
    } else if (
      line === `branch refs/heads/${branchName}` &&
      worktreePath !== null
    ) {
      return worktreePath;
    }
  }
  return null;
}

export const {
  readGitRepo,
  readCheckoutRef,
  readRefs,
  detectGitRepo,
  detectGitSource,
  ensureGitRepo,
  getCheckoutRef,
  getCurrentBranch,
  getGitCommonDir,
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  hasRef,
  readBranchRelation,
  readDefaultBranch,
  readDefaultBranchRefs,
} = createGitQueries(runGit);
