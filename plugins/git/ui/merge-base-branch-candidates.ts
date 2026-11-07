import type { GitBranchRefClassification } from "@bb/domain";

interface GetMergeBaseBranchCandidatesArgs {
  mergeBaseBranch?: string;
  mergeBaseBranchRef?: GitBranchRefClassification | null;
  mergeBaseBranchOptions?: readonly string[];
  remoteMergeBaseBranchOptions?: readonly string[];
}

export interface MergeBaseBranchCandidateGroups {
  options: readonly string[];
  remoteOptions: readonly string[];
}

export function getMergeBaseBranchCandidateGroups({
  mergeBaseBranch,
  mergeBaseBranchRef,
  mergeBaseBranchOptions,
  remoteMergeBaseBranchOptions,
}: GetMergeBaseBranchCandidatesArgs): MergeBaseBranchCandidateGroups {
  const fromProps = mergeBaseBranchOptions ?? [];
  const fromRemoteProps = remoteMergeBaseBranchOptions ?? [];
  const selectedRef =
    mergeBaseBranchRef?.name === mergeBaseBranch ? mergeBaseBranchRef : null;
  const selectedOptionKind =
    selectedRef && selectedRef.kind !== "missing"
      ? selectedRef.kind
      : undefined;
  if (
    !mergeBaseBranch ||
    fromProps.includes(mergeBaseBranch) ||
    fromRemoteProps.includes(mergeBaseBranch)
  ) {
    return {
      options: fromProps,
      remoteOptions: fromRemoteProps,
    };
  }
  if (selectedOptionKind === "remote") {
    return {
      options: fromProps,
      remoteOptions: [mergeBaseBranch, ...fromRemoteProps],
    };
  }
  if (selectedOptionKind === "local" || selectedRef?.kind !== "missing") {
    return {
      options: [mergeBaseBranch, ...fromProps],
      remoteOptions: fromRemoteProps,
    };
  }
  return { options: fromProps, remoteOptions: fromRemoteProps };
}
