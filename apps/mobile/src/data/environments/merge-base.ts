import {
  resolveEnvironmentMergeBaseBranch,
  type Environment,
  type GitBranchRefClassification,
  type WorkspaceStatus,
} from "@bb/domain";

/**
 * Merge-base branch resolution (ports of the web
 * `useEnvironmentMergeBase` helpers and `getMergeBaseBranchCandidateGroups`):
 * which branch the banner compares against, what gets persisted when the
 * user picks one, and how the picker lists the current pick.
 */

type MergeBaseEnvironment = Pick<
  Environment,
  "baseBranch" | "defaultBranch" | "mergeBaseBranch"
>;

/** The branch the server would use when nothing is configured. */
function resolveImplicitMergeBaseBranch({
  environment,
  workspaceStatus,
}: {
  environment: MergeBaseEnvironment | undefined;
  workspaceStatus: WorkspaceStatus | undefined;
}): string | undefined {
  return (
    environment?.baseBranch ??
    workspaceStatus?.branch.defaultBranch ??
    environment?.defaultBranch ??
    undefined
  );
}

/** The branch the UI compares against right now (selection wins). */
export function resolveEffectiveMergeBaseBranch({
  environment,
  selectedMergeBaseBranch,
  workspaceStatus,
}: {
  environment: MergeBaseEnvironment | undefined;
  selectedMergeBaseBranch: string | undefined;
  workspaceStatus: WorkspaceStatus | undefined;
}): string | undefined {
  return (
    selectedMergeBaseBranch ??
    environment?.mergeBaseBranch ??
    environment?.baseBranch ??
    workspaceStatus?.mergeBase?.mergeBaseBranch ??
    workspaceStatus?.branch.defaultBranch ??
    resolveEnvironmentMergeBaseBranch(environment)
  );
}

/**
 * What `PATCH /environments/:id { mergeBaseBranch }` receives for a pick:
 * the implicit default is stored as `null` (clear the override), anything
 * else verbatim, and an empty pick clears too.
 */
export function resolvePersistedMergeBaseBranch({
  branch,
  environment,
  workspaceStatus,
}: {
  branch: string;
  environment: MergeBaseEnvironment | undefined;
  workspaceStatus: WorkspaceStatus | undefined;
}): string | null {
  const normalizedBranch = branch.trim();
  if (normalizedBranch.length === 0) {
    return null;
  }
  return normalizedBranch ===
    resolveImplicitMergeBaseBranch({ environment, workspaceStatus })
    ? null
    : normalizedBranch;
}

export interface MergeBaseVisibility {
  /** Enough data to talk about a comparison at all. */
  showBranchComparison: boolean;
  /** Offer the merge-base picker (hidden when sitting on the default branch). */
  showMergeBase: boolean;
}

export function resolveMergeBaseVisibility({
  effectiveMergeBaseBranch,
  workspaceStatus,
}: {
  effectiveMergeBaseBranch: string | undefined;
  workspaceStatus: WorkspaceStatus | undefined;
}): MergeBaseVisibility {
  const showBranchComparison = Boolean(
    effectiveMergeBaseBranch || workspaceStatus?.branch.defaultBranch,
  );
  const isOnDefaultBranch =
    workspaceStatus?.branch.currentBranch != null &&
    workspaceStatus.branch.currentBranch ===
      workspaceStatus.branch.defaultBranch;
  return {
    showBranchComparison,
    showMergeBase:
      showBranchComparison &&
      Boolean(effectiveMergeBaseBranch) &&
      !isOnDefaultBranch,
  };
}

export interface MergeBaseBranchCandidateGroups {
  options: readonly string[];
  remoteOptions: readonly string[];
}

/**
 * The picker's local/remote lists with the current merge base pinned into
 * the group it belongs to when the server page did not include it (a stale
 * or filtered-out pick must still be selectable/visible).
 */
export function getMergeBaseBranchCandidateGroups({
  mergeBaseBranch,
  mergeBaseBranchRef,
  mergeBaseBranchOptions,
  remoteMergeBaseBranchOptions,
}: {
  mergeBaseBranch: string | undefined;
  mergeBaseBranchRef: GitBranchRefClassification | null | undefined;
  mergeBaseBranchOptions: readonly string[];
  remoteMergeBaseBranchOptions: readonly string[];
}): MergeBaseBranchCandidateGroups {
  const selectedRef =
    mergeBaseBranchRef?.name === mergeBaseBranch ? mergeBaseBranchRef : null;
  const selectedOptionKind =
    selectedRef && selectedRef.kind !== "missing"
      ? selectedRef.kind
      : undefined;
  if (
    !mergeBaseBranch ||
    mergeBaseBranchOptions.includes(mergeBaseBranch) ||
    remoteMergeBaseBranchOptions.includes(mergeBaseBranch)
  ) {
    return {
      options: mergeBaseBranchOptions,
      remoteOptions: remoteMergeBaseBranchOptions,
    };
  }
  if (selectedOptionKind === "remote") {
    return {
      options: mergeBaseBranchOptions,
      remoteOptions: [mergeBaseBranch, ...remoteMergeBaseBranchOptions],
    };
  }
  if (selectedOptionKind === "local" || selectedRef?.kind !== "missing") {
    return {
      options: [mergeBaseBranch, ...mergeBaseBranchOptions],
      remoteOptions: remoteMergeBaseBranchOptions,
    };
  }
  return {
    options: mergeBaseBranchOptions,
    remoteOptions: remoteMergeBaseBranchOptions,
  };
}
