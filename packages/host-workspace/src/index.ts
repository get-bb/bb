export {
  getPersonalWorkspaceRoot,
  openWorkspace,
  provisionWorkspace,
  validatePersonalWorkspaceTargetPath,
} from "./provision.js";
export type {
  HostWorkspace,
  PersonalWorkspaceOpts,
  ProvisionWorkspaceArgs,
  UnmanagedCheckoutOpts,
  UnmanagedWorkspaceOpts,
  ManagedWorkspaceBaseOpts,
  ManagedWorktreeOpts,
  ReconnectManagedWorktreeOpts,
} from "./provision.js";

export type {
  CommitOptions,
  CommitResult,
  DiffOptions,
  DiffResult,
  FetchOptions,
  SquashMergeOptions,
  SquashMergeResult,
  StatusOptions,
} from "./workspace.js";

export {
  provisionWorkflowWorktree,
  teardownWorkflowWorktree,
} from "./workflow-worktree.js";
export type {
  ProvisionWorkflowWorktreeArgs,
  TeardownWorkflowWorktreeArgs,
  WorkflowWorktree,
  WorkflowWorktreeTeardownResult,
} from "./workflow-worktree.js";

export {
  WorkspaceError,
  detectGitRepo,
  getCheckoutRef,
  getCurrentBranch,
  getWorkspaceGitOperation,
  gitBlobSize,
  hasUncommittedChanges,
  listBranches,
  listRemoteBranches,
  readDefaultBranch,
  readGitBlob,
} from "./git.js";
export type { ReadGitBlobResult } from "./git.js";

export {
  getPullRequestForBranch,
  parseGitHostPullRequest,
} from "./git-host.js";
