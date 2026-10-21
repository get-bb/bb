export { provisionWorkspace } from "./provision.js";
export type { HostWorkspace, ProvisionWorkspaceArgs } from "./provision.js";

export type { PullRequestActionOptions } from "./workspace.js";
export { withGitRefMutationLock } from "bb-environment-provider-host/process-local-lock";

export {
  WorkspaceError,
  detectGitRepo,
  detectLinkedWorktree,
  detectGitRepoKind,
  fetchRemoteBranches,
  getCheckoutRef,
  getWorkspaceGitOperation,
  getGitCommonDir,
  hasUncommittedChanges,
  listBranchRefsWithDefaults,
  readDefaultBranchRefs,
  readGitBlob,
  runGit,
} from "bb-git-host/git";
export type { GitProcessOptions } from "bb-git-host/git";

export {
  listWorkspaceBranchOptions,
  inspectWorkspaceGitSource,
} from "bb-git-host/branch-options";
