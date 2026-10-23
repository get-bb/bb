import type { DefaultBranchRelation } from "./git.js";

export interface WorktreeBaseBranchCandidates {
  defaultBranch: string | null;
  defaultBranchRelation: DefaultBranchRelation | null;
  originDefaultBranch: string | null;
}

export function selectWorktreeBaseBranch(
  candidates: WorktreeBaseBranchCandidates,
): string | null {
  if (!candidates.originDefaultBranch) {
    return candidates.defaultBranch;
  }
  if (!candidates.defaultBranch) {
    return candidates.originDefaultBranch;
  }
  if (
    candidates.defaultBranchRelation === "equal" ||
    candidates.defaultBranchRelation === "local-behind"
  ) {
    return candidates.originDefaultBranch;
  }
  return candidates.defaultBranch;
}
