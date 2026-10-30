export { provisionWorkspace } from "./provision.js";
export type { HostWorkspace, ProvisionWorkspaceArgs } from "./provision.js";

export type { LocalStateSnapshot } from "./host-workspace.js";
export { withGitRefMutationLock } from "bb-environment-provider-host/process-local-lock";

export {
  detectLinkedWorktree,
  getCheckoutRef,
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  readGitBlob,
} from "./git.js";
export type { SharedGitRefsSnapshot } from "./git.js";
