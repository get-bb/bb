import { useAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useMemo, useState } from "react";
import { rawStringLocalStorage } from "@/lib/browser-storage";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import type { RootComposeSelectedBranch } from "./root-compose-thread-environment";

const WORKTREE_BASE_BRANCH_STORAGE_KEY = "bb.promptbox.worktree-base-branch";
const INACTIVE_WORKTREE_BASE_BRANCH_STORAGE_KEY =
  "bb.promptbox.worktree-base-branch.inactive";

interface BranchSelectionScope {
  environmentValue: string;
  projectId: string;
}

interface BranchSelectionScopeArgs {
  environmentValue: string;
  projectId: string | undefined;
}

interface ScopedSelectedBranch {
  branch: RootComposeSelectedBranch;
  scope: BranchSelectionScope;
}

type PersistedBranchNameSetter = (value: string) => void;

export interface UseScopedBranchSelectionArgs extends BranchSelectionScopeArgs {
  rememberSelection: boolean;
}

export interface UseScopedBranchSelectionResult {
  onBranchChange: (name: string) => void;
  onClearBranch: () => void;
  onCreateBranch: (currentBranch: string | null) => void;
  onCreateBranchFrom: (name: string) => void;
  selectedBranch: RootComposeSelectedBranch | null;
}

export interface ResolveSelectedBranchArgs {
  rememberedBranchName: string;
  rememberSelection: boolean;
  selectedBranch: RootComposeSelectedBranch | null;
}

interface PersistedWorktreeBaseBranchSelection {
  setValue: PersistedBranchNameSetter;
  value: string;
}

interface WorktreeBaseBranchStorageKeyArgs {
  environmentValue: string;
  projectId: string;
}

const worktreeBaseBranchAtomFamily = atomFamily((storageKey: string) =>
  atomWithStorage<string>(storageKey, "", rawStringLocalStorage, {
    getOnInit: true,
  }),
);

function getWorktreeBaseBranchStorageKey({
  environmentValue,
  projectId,
}: WorktreeBaseBranchStorageKeyArgs): string {
  return getProjectScopedStorageKey(
    `${WORKTREE_BASE_BRANCH_STORAGE_KEY}.${encodeURIComponent(
      environmentValue.trim(),
    )}`,
    projectId,
  );
}

function resolveBranchSelectionScope(
  args: BranchSelectionScopeArgs,
): BranchSelectionScope | null {
  if (!args.projectId || !args.environmentValue) {
    return null;
  }

  return {
    environmentValue: args.environmentValue,
    projectId: args.projectId,
  };
}

function matchesBranchSelectionScope(
  left: BranchSelectionScope | undefined,
  right: BranchSelectionScope | null,
) {
  return (
    left !== undefined &&
    right !== null &&
    left.projectId === right.projectId &&
    left.environmentValue === right.environmentValue
  );
}

function usePersistedWorktreeBaseBranchSelection(
  scope: BranchSelectionScope | null,
): PersistedWorktreeBaseBranchSelection {
  const storageKey = useMemo(
    () =>
      scope
        ? getWorktreeBaseBranchStorageKey(scope)
        : INACTIVE_WORKTREE_BASE_BRANCH_STORAGE_KEY,
    [scope],
  );
  const [value, setAtomValue] = useAtom(
    worktreeBaseBranchAtomFamily(storageKey),
  );
  const setValue = useCallback(
    (nextValue: string) => {
      if (!scope) {
        return;
      }

      setAtomValue(nextValue);
    },
    [scope, setAtomValue],
  );

  return {
    setValue,
    value: scope ? value : "",
  };
}

export function resolveSelectedBranch({
  rememberedBranchName,
  rememberSelection,
  selectedBranch,
}: ResolveSelectedBranchArgs): RootComposeSelectedBranch | null {
  if (selectedBranch) {
    return selectedBranch;
  }

  if (!rememberSelection || rememberedBranchName.length === 0) {
    return null;
  }

  return {
    name: rememberedBranchName,
    isNew: false,
  };
}

export function useScopedBranchSelection(
  args: UseScopedBranchSelectionArgs,
): UseScopedBranchSelectionResult {
  const [selectedBranchState, setSelectedBranchState] =
    useState<ScopedSelectedBranch | null>(null);
  const rememberSelection = args.rememberSelection;
  const scope = useMemo(
    () =>
      resolveBranchSelectionScope({
        environmentValue: args.environmentValue,
        projectId: args.projectId,
      }),
    [args.environmentValue, args.projectId],
  );
  const { setValue: setRememberedBranchName, value: rememberedBranchName } =
    usePersistedWorktreeBaseBranchSelection(
      rememberSelection ? scope : null,
    );
  const selectedBranchFromState =
    selectedBranchState !== null &&
    matchesBranchSelectionScope(selectedBranchState.scope, scope)
      ? selectedBranchState.branch
      : null;
  const selectedBranch = resolveSelectedBranch({
    rememberedBranchName,
    rememberSelection,
    selectedBranch: selectedBranchFromState,
  });

  const rememberBranchName = useCallback(
    (name: string) => {
      if (rememberSelection) {
        setRememberedBranchName(name);
      }
    },
    [rememberSelection, setRememberedBranchName],
  );

  const onBranchChange = useCallback(
    (name: string) => {
      if (!scope) {
        return;
      }

      rememberBranchName(name);
      setSelectedBranchState({
        scope,
        branch: {
          name,
          isNew: false,
        },
      });
    },
    [rememberBranchName, scope],
  );

  const onCreateBranch = useCallback(
    (currentBranch: string | null) => {
      if (!scope) {
        return;
      }

      const branchName = selectedBranch?.name ?? currentBranch;
      if (!branchName) {
        if (rememberSelection) {
          setRememberedBranchName("");
        }
        setSelectedBranchState((previous) =>
          matchesBranchSelectionScope(previous?.scope, scope) ? null : previous,
        );
        return;
      }

      rememberBranchName(branchName);
      setSelectedBranchState({
        scope,
        branch: {
          name: branchName,
          isNew: true,
        },
      });
    },
    [
      rememberBranchName,
      rememberSelection,
      scope,
      selectedBranch?.name,
      setRememberedBranchName,
    ],
  );

  const onCreateBranchFrom = useCallback(
    (name: string) => {
      if (!scope) {
        return;
      }

      rememberBranchName(name);
      setSelectedBranchState({
        scope,
        branch: { name, isNew: true },
      });
    },
    [rememberBranchName, scope],
  );

  const onClearBranch = useCallback(() => {
    if (!scope) {
      return;
    }

    if (rememberSelection) {
      setRememberedBranchName("");
    }
    setSelectedBranchState((previous) =>
      matchesBranchSelectionScope(previous?.scope, scope) ? null : previous,
    );
  }, [rememberSelection, scope, setRememberedBranchName]);

  return {
    onBranchChange,
    onClearBranch,
    onCreateBranch,
    onCreateBranchFrom,
    selectedBranch,
  };
}
