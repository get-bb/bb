import type { GitSourceInspection } from "@bb/domain";

interface ResolveDefaultWorktreeBaseBranchArgs {
  defaultBranch: GitSourceInspection["defaultBranch"];
  originDefaultBranch: GitSourceInspection["originDefaultBranch"];
}

export function resolveDefaultWorktreeBaseBranch(
  args: ResolveDefaultWorktreeBaseBranchArgs,
): string | null {
  return args.originDefaultBranch ?? args.defaultBranch;
}
