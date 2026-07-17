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
  PullRequestActionOptions,
  SquashMergeOptions,
  SquashMergeResult,
  StatusOptions,
} from "./workspace.js";

export {
  WorkspaceError,
  detectGitRepo,
  fetchRemoteBranches,
  getCheckoutRef,
  getCurrentBranch,
  getWorkspaceGitOperation,
  getGitCommonDir,
  gitBlobSize,
  hasUncommittedChanges,
  listBranches,
  listRemoteBranches,
  readDefaultBranch,
  readDefaultBranchRefs,
  readGitBlob,
  runGit,
} from "./git.js";
export type {
  DefaultBranchRefs,
  FetchRemoteBranchesResult,
  ReadGitBlobResult,
} from "./git.js";

export {
  getPullRequestForBranch,
  parseGitHostPullRequest,
  type GitHostPullRequestLookup,
} from "./git-host.js";
