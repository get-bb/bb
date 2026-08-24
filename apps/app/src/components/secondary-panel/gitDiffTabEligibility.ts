export type GitDiffTabStatus = "loading" | "eligible" | "ineligible" | "error";

export function resolveGitDiffTabStatus({
  environmentId,
  environmentIsGitRepo,
  environmentLoadFailed,
  hasResolvedThread,
}: {
  environmentId: string | null;
  environmentIsGitRepo: boolean | undefined;
  environmentLoadFailed: boolean;
  hasResolvedThread: boolean;
}): GitDiffTabStatus {
  if (!hasResolvedThread) return "loading";
  if (environmentId === null) return "ineligible";
  if (environmentIsGitRepo === true) return "eligible";
  if (environmentIsGitRepo === false) return "ineligible";
  return environmentLoadFailed ? "error" : "loading";
}
