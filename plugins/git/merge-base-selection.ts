import {
  resolveEnvironmentMergeBaseBranch,
  type Environment,
} from "@bb/domain";
import { type WorkspaceStatus } from "bb-git-contract";

interface ResolveEffectiveMergeBaseBranchParams {
  environment?: Environment;
  selectedMergeBaseBranch?: string;
  workspaceStatus?: WorkspaceStatus;
}

interface ResolveImplicitMergeBaseBranchParams {
  environment?: Environment;
  workspaceStatus?: WorkspaceStatus;
}

interface ResolvePersistedMergeBaseBranchParams extends ResolveImplicitMergeBaseBranchParams {
  branch: string;
}

function resolveImplicitMergeBaseBranch({
  environment,
  workspaceStatus,
}: ResolveImplicitMergeBaseBranchParams): string | undefined {
  return (
    environment?.baseBranch ??
    workspaceStatus?.branch.defaultBranch ??
    environment?.defaultBranch ??
    undefined
  );
}

export function resolveEffectiveMergeBaseBranch({
  environment,
  selectedMergeBaseBranch,
  workspaceStatus,
}: ResolveEffectiveMergeBaseBranchParams): string | undefined {
  return (
    selectedMergeBaseBranch ??
    environment?.mergeBaseBranch ??
    environment?.baseBranch ??
    workspaceStatus?.mergeBase?.mergeBaseBranch ??
    workspaceStatus?.branch.defaultBranch ??
    resolveEnvironmentMergeBaseBranch(environment)
  );
}

export function resolvePersistedMergeBaseBranch({
  branch,
  environment,
  workspaceStatus,
}: ResolvePersistedMergeBaseBranchParams): string | null {
  const normalizedBranch = branch.trim();
  if (normalizedBranch.length === 0) {
    return null;
  }

  return normalizedBranch ===
    resolveImplicitMergeBaseBranch({ environment, workspaceStatus })
    ? null
    : normalizedBranch;
}
