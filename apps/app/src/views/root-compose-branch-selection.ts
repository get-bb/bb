import { useCallback, useState } from "react";
import type { RootComposeSelectedBranch } from "./root-compose-thread-environment";

export interface BranchSelectionScopeArgs {
  environmentValue: string;
  projectId: string | undefined;
}

export interface UseScopedBranchSelectionResult {
  onBranchChange: (name: string) => void;
  onClearBranch: () => void;
  onCreateBranch: (currentBranch: string | null) => void;
  onCreateBranchFrom: (name: string) => void;
  selectedBranch: RootComposeSelectedBranch | null;
}

// Identifies the picker's active scope. A null key means there is no usable
// scope yet (missing project or environment), so branch picks are inert.
export function getBranchSelectionScopeKey(
  args: BranchSelectionScopeArgs,
): string | null {
  if (!args.projectId || !args.environmentValue) {
    return null;
  }
  // NUL separates the parts so distinct (project, environment) pairs can never
  // collide into the same key.
  return `${args.projectId}\u0000${args.environmentValue}`;
}

// Carries a picked branch only while the scope is unchanged. Switching
// environment mode (e.g. New Worktree -> Working Locally) or project changes
// the scope key and drops the pick, so re-entering a mode re-seeds from its
// fresh default instead of restoring a stale selection.
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

  // Reset during render (not in an effect) so a stale pick never paints for a
  // frame before clearing when the scope changes.
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
