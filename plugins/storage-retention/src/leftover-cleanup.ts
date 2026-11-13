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

type RetryOutcome = { environmentId: string; message: string };

export function summarizeLeftoverRetry(result: {
  retriedCount: number;
  kept: RetryOutcome[];
  failed: RetryOutcome[];
}): { state: "completed" | "failed"; message: string } {
  const { retriedCount, kept, failed } = result;
  const [firstFailure] = failed;
  if (retriedCount === 0 && kept.length === 0 && firstFailure)
    return {
      state: "failed",
      message:
        failed.length === 1
          ? firstFailure.message
          : `${failed.length} checkouts couldn’t be removed. First error: ${firstFailure.message}`,
    };
  const [onlyKept] = kept;
  const parts = [
    ...(retriedCount > 0 || (kept.length === 0 && failed.length === 0)
      ? [
          `Removed ${retriedCount} ${retriedCount === 1 ? "checkout" : "checkouts"}`,
        ]
      : []),
    ...(onlyKept && kept.length === 1
      ? [onlyKept.message]
      : kept.length > 1
        ? [
            `${kept.length} kept because they have uncommitted changes or something is running in them`,
          ]
        : []),
    ...(failed.length > 0 ? [`${failed.length} couldn’t be removed`] : []),
  ];
  return { state: "completed", message: parts.join("; ") };
}
