import { useCallback, useState } from "react";
import type { RootComposeSelectedBranch } from "./root-compose-thread-environment";

interface BranchSelectionScopeArgs {
  environmentValue: string;
  projectId: string | undefined;
}

interface UseScopedBranchSelectionResult {
  onBranchChange: (name: string) => void;
  onClearBranch: () => void;
  onCreateBranch: (currentBranch: string | null) => void;
  onCreateBranchFrom: (name: string) => void;
  selectedBranch: RootComposeSelectedBranch | null;
}

export function getBranchSelectionScopeKey(
  args: BranchSelectionScopeArgs,
): string | null {
  if (!args.projectId || !args.environmentValue) {
    return null;
  }
  return `${args.projectId}\u0000${args.environmentValue}`;
}

export function carryBranchSelectionAcrossScope(args: {
  previousScopeKey: string | null;
  currentScopeKey: string | null;
  selectedBranch: RootComposeSelectedBranch | null;
}): RootComposeSelectedBranch | null {
  return args.currentScopeKey === args.previousScopeKey
    ? args.selectedBranch
    : null;
}

export function useScopedBranchSelection(
  args: BranchSelectionScopeArgs,
): UseScopedBranchSelectionResult {
  const scopeKey = getBranchSelectionScopeKey(args);
  const scopeUsable = scopeKey !== null;
  const [selectedBranchState, setSelectedBranchState] =
    useState<RootComposeSelectedBranch | null>(null);
  const [trackedScopeKey, setTrackedScopeKey] = useState<string | null>(
    scopeKey,
  );

  const selectedBranch = carryBranchSelectionAcrossScope({
    previousScopeKey: trackedScopeKey,
    currentScopeKey: scopeKey,
    selectedBranch: selectedBranchState,
  });

  if (trackedScopeKey !== scopeKey) {
    setTrackedScopeKey(scopeKey);
    if (selectedBranchState !== null) {
      setSelectedBranchState(null);
    }
  }

  const onBranchChange = useCallback(
    (name: string) => {
      if (!scopeUsable) return;
      setSelectedBranchState({ name, isNew: false });
    },
    [scopeUsable],
  );

  const onCreateBranch = useCallback(
    (currentBranch: string | null) => {
      if (!scopeUsable) return;
      const branchName = selectedBranch?.name ?? currentBranch;
      setSelectedBranchState(
        branchName ? { name: branchName, isNew: true } : null,
      );
    },
    [scopeUsable, selectedBranch?.name],
  );

  const onCreateBranchFrom = useCallback(
    (name: string) => {
      if (!scopeUsable) return;
      setSelectedBranchState({ name, isNew: true });
    },
    [scopeUsable],
  );

  const onClearBranch = useCallback(() => {
    if (!scopeUsable) return;
    setSelectedBranchState(null);
  }, [scopeUsable]);

  return {
    onBranchChange,
    onClearBranch,
    onCreateBranch,
    onCreateBranchFrom,
    selectedBranch,
  };
}
