import type { HostStorageLeftoverWorktree } from "./storage-types.js";

export function describeLeftoverCleanup(
  cleanup: HostStorageLeftoverWorktree["cleanup"],
): string {
  switch (cleanup.state) {
    case "retrying":
      return "BB is retrying the cleanup";
    case "interrupted":
      return "Cleanup was interrupted. BB removes it once nothing is running in it and it has no uncommitted changes";
    case "uncommittedChanges":
      return `Kept because it has ${cleanup.changedFileCount} uncommitted ${cleanup.changedFileCount === 1 ? "change" : "changes"}`;
    case "processesRunning":
      return "Kept because a program is still running in this folder";
    case "recoveryUnsupported":
      return "Kept because this machine’s BB can’t check for running programs yet; update BB on this machine";
    case "failed":
      return cleanup.message;
  }
}
