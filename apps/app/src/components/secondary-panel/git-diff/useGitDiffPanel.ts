import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitBranchRefClassification } from "@bb/domain";
import { useEnvironmentMergeBaseBranches } from "../../../hooks/queries/environment-queries";
import type { SecondaryFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import {
  selectScopedMergeBaseBranch,
  selectScopedPendingGitDiffIntent,
  type PendingGitDiffIntent,
  type SelectedMergeBaseBranchState,
} from "./gitDiffPanelHelpers";

type ThreadSecondaryPanelSetter = (
  panel: ThreadSecondaryPanelTab | null,
) => void;

interface UseGitDiffPanelParams {
  activeSecondaryTab: SecondaryFixedPanelTab | null;
  clearActiveFileTabs: () => void;
  defaultMergeBaseBranch?: string;
  environmentId?: string;
  mergeBaseBranchOptionsEnabled?: boolean;
  setThreadSecondaryPanel: ThreadSecondaryPanelSetter;
  threadId: string;
}

function prependSelectedBranch(
  list: string[] | undefined,
  selectedRef: GitBranchRefClassification | null | undefined,
  kind: "local" | "remote",
): string[] | undefined {
  if (!list) {
    return undefined;
  }

  return selectedRef?.kind === kind && !list.includes(selectedRef.name)
    ? [selectedRef.name, ...list]
    : list;
}

export function useGitDiffPanel({
  activeSecondaryTab,
  clearActiveFileTabs,
  defaultMergeBaseBranch,
  environmentId,
  mergeBaseBranchOptionsEnabled = false,
  setThreadSecondaryPanel,
  threadId,
}: UseGitDiffPanelParams) {
  const [selectedMergeBaseBranchState, setSelectedMergeBaseBranchState] =
    useState<SelectedMergeBaseBranchState>({ environmentId });
  const selectedMergeBaseBranch = selectScopedMergeBaseBranch(
    selectedMergeBaseBranchState,
    environmentId,
  );
  const setSelectedMergeBaseBranch = useCallback(
    (branch: string | undefined) => {
      setSelectedMergeBaseBranchState({ branch, environmentId });
    },
    [environmentId],
  );
  const [pendingGitDiffIntent, setPendingGitDiffIntent] =
    useState<PendingGitDiffIntent | null>(null);
  const currentPendingGitDiffIntent = selectScopedPendingGitDiffIntent(
    pendingGitDiffIntent,
    { environmentId, threadId },
  );
  const pendingGitDiffCommitSha =
    currentPendingGitDiffIntent?.kind === "commit"
      ? currentPendingGitDiffIntent.sha
      : null;
  const pendingGitDiffScrollPath =
    currentPendingGitDiffIntent?.kind === "file"
      ? currentPendingGitDiffIntent.path
      : null;
  const clearPendingGitDiffIntent = useCallback(() => {
    setPendingGitDiffIntent((current) =>
      selectScopedPendingGitDiffIntent(current, { environmentId, threadId }) ===
      null
        ? current
        : null,
    );
  }, [environmentId, threadId]);
  const [mergeBaseBranchSearchQuery, setMergeBaseBranchSearchQuery] =
    useState("");
  const requestedMergeBaseBranch =
    selectedMergeBaseBranch ?? defaultMergeBaseBranch;

  const {
    data: mergeBaseBranches,
    isFetching: isLoadingMergeBaseBranchOptions,
  } = useEnvironmentMergeBaseBranches(environmentId ?? "", {
    enabled:
      Boolean(environmentId) &&
      (mergeBaseBranchOptionsEnabled ||
        activeSecondaryTab?.kind === "git-diff"),
    query: mergeBaseBranchSearchQuery,
    selectedBranch: requestedMergeBaseBranch,
  });
  const selectedMergeBaseBranchRef = mergeBaseBranches?.selectedBranch;
  const mergeBaseBranchList = mergeBaseBranches?.branches;
  const mergeBaseRemoteBranchList = mergeBaseBranches?.remoteBranches;
  const mergeBaseBranchOptions = useMemo(
    () =>
      prependSelectedBranch(
        mergeBaseBranchList,
        selectedMergeBaseBranchRef,
        "local",
      ),
    [mergeBaseBranchList, selectedMergeBaseBranchRef],
  );
  const mergeBaseRemoteBranchOptions = useMemo(
    () =>
      prependSelectedBranch(
        mergeBaseRemoteBranchList,
        selectedMergeBaseBranchRef,
        "remote",
      ),
    [mergeBaseRemoteBranchList, selectedMergeBaseBranchRef],
  );
  useEffect(() => {
    setMergeBaseBranchSearchQuery("");
    setPendingGitDiffIntent(null);
  }, [environmentId, threadId]);

  const openThreadDiffPanel = useCallback(() => {
    setThreadSecondaryPanel("git-diff");
  }, [setThreadSecondaryPanel]);

  const closeThreadSecondaryPanel = useCallback(() => {
    setThreadSecondaryPanel(null);
  }, [setThreadSecondaryPanel]);

  const openDiffFile = useCallback(
    (path: string) => {
      clearActiveFileTabs();
      setPendingGitDiffIntent({ environmentId, kind: "file", path, threadId });
      openThreadDiffPanel();
    },
    [clearActiveFileTabs, environmentId, openThreadDiffPanel, threadId],
  );

  const openCommitDiff = useCallback(
    (sha: string) => {
      clearActiveFileTabs();
      setPendingGitDiffIntent({ environmentId, kind: "commit", sha, threadId });
      openThreadDiffPanel();
    },
    [clearActiveFileTabs, environmentId, openThreadDiffPanel, threadId],
  );

  return {
    closeThreadSecondaryPanel,
    clearPendingGitDiffIntent,
    isLoadingMergeBaseBranchOptions,
    mergeBaseBranchOptions,
    mergeBaseRemoteBranchOptions,
    openCommitDiff,
    openDiffFile,
    openThreadDiffPanel,
    pendingGitDiffCommitSha,
    pendingGitDiffScrollPath,
    requestedMergeBaseBranch,
    selectedMergeBaseBranch,
    selectedMergeBaseBranchRef,
    setMergeBaseBranchSearchQuery,
    setSelectedMergeBaseBranch,
  };
}
