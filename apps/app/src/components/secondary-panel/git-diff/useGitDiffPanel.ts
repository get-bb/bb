import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useEnvironmentMergeBaseBranches } from "../../../hooks/queries/environment-queries";
import type { SecondaryFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { selectedMergeBaseBranchAtom } from "../threadSecondaryPanelAtoms";

type ThreadSecondaryPanelSetter = (
  panel: ThreadSecondaryPanelTab | null,
) => void;

interface UseGitDiffPanelParams {
  activeSecondaryTab: SecondaryFixedPanelTab | null;
  clearActiveFileTabs: () => void;
  defaultMergeBaseBranch?: string;
  environmentId?: string;
  mergeBaseBranchOptionsEnabled?: boolean;
  onRequestCommitDiffSelection: (sha: string) => void;
  onRequestDiffFileFocus: (path: string) => void;
  setThreadSecondaryPanel: ThreadSecondaryPanelSetter;
}

export function useGitDiffPanel({
  activeSecondaryTab,
  clearActiveFileTabs,
  defaultMergeBaseBranch,
  environmentId,
  mergeBaseBranchOptionsEnabled = false,
  onRequestCommitDiffSelection,
  onRequestDiffFileFocus,
  setThreadSecondaryPanel,
}: UseGitDiffPanelParams) {
  const selectedMergeBaseBranch = useAtomValue(selectedMergeBaseBranchAtom);
  const setSelectedMergeBaseBranch = useSetAtom(selectedMergeBaseBranchAtom);
  const [mergeBaseBranchSearchQuery, setMergeBaseBranchSearchQuery] =
    useState("");
  const requestedMergeBaseBranch =
    selectedMergeBaseBranch ?? defaultMergeBaseBranch;

  const {
    data: mergeBaseBranches,
    isFetching: isLoadingMergeBaseBranchOptions,
  } = useEnvironmentMergeBaseBranches(environmentId ?? "", {
    // Branch options are only needed once the picker can open or the diff
    // panel is visible; initial thread load can use the persisted/default base.
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
  const mergeBaseBranchOptions = useMemo(() => {
    if (!mergeBaseBranchList) {
      return undefined;
    }

    return selectedMergeBaseBranchRef?.kind === "local" &&
      !mergeBaseBranchList.includes(selectedMergeBaseBranchRef.name)
      ? [selectedMergeBaseBranchRef.name, ...mergeBaseBranchList]
      : mergeBaseBranchList;
  }, [mergeBaseBranchList, selectedMergeBaseBranchRef]);
  const mergeBaseRemoteBranchOptions = useMemo(() => {
    if (!mergeBaseRemoteBranchList) {
      return undefined;
    }

    return selectedMergeBaseBranchRef?.kind === "remote" &&
      !mergeBaseRemoteBranchList.includes(selectedMergeBaseBranchRef.name)
      ? [selectedMergeBaseBranchRef.name, ...mergeBaseRemoteBranchList]
      : mergeBaseRemoteBranchList;
  }, [mergeBaseRemoteBranchList, selectedMergeBaseBranchRef]);
  useEffect(() => {
    setSelectedMergeBaseBranch(undefined);
    setMergeBaseBranchSearchQuery("");
  }, [environmentId, setSelectedMergeBaseBranch]);

  const openThreadSecondaryPanel = useCallback(
    (panel: ThreadSecondaryPanelTab) => {
      setThreadSecondaryPanel(panel);
    },
    [setThreadSecondaryPanel],
  );

  const openThreadDiffPanel = useCallback(() => {
    openThreadSecondaryPanel("git-diff");
  }, [openThreadSecondaryPanel]);

  const closeThreadSecondaryPanel = useCallback(() => {
    setThreadSecondaryPanel(null);
  }, [setThreadSecondaryPanel]);

  const openDiffFile = useCallback(
    (path: string) => {
      clearActiveFileTabs();
      onRequestDiffFileFocus(path);
      openThreadDiffPanel();
    },
    [clearActiveFileTabs, onRequestDiffFileFocus, openThreadDiffPanel],
  );

  const openCommitDiff = useCallback(
    (sha: string) => {
      clearActiveFileTabs();
      onRequestCommitDiffSelection(sha);
      openThreadDiffPanel();
    },
    [clearActiveFileTabs, onRequestCommitDiffSelection, openThreadDiffPanel],
  );

  return {
    closeThreadSecondaryPanel,
    defaultMergeBaseBranch,
    isLoadingMergeBaseBranchOptions,
    mergeBaseBranchOptions,
    mergeBaseRemoteBranchOptions,
    openCommitDiff,
    openDiffFile,
    openThreadDiffPanel,
    openThreadSecondaryPanel,
    selectedMergeBaseBranch,
    selectedMergeBaseBranchRef,
    setMergeBaseBranchSearchQuery,
    setSelectedMergeBaseBranch,
  };
}
