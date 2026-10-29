import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { useGitBranches, useSetMergeBase } from "./queries.js";
import type { GitBranchRefClassification } from "@bb/domain";
import type { WorkspaceStatus } from "../contract.js";

const overrides = new Map<string, string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setOverride(environmentId: string, branch: string | null): void {
  if (branch === null) overrides.delete(environmentId);
  else overrides.set(environmentId, branch);
  notify();
}

function useOverride(environmentId: string | null): string | undefined {
  return useSyncExternalStore(subscribe, () =>
    environmentId === null ? undefined : overrides.get(environmentId),
  );
}

function prependSelectedBranch(
  branches: readonly string[] | undefined,
  selected: GitBranchRefClassification | null | undefined,
  kind: "local" | "remote",
): string[] {
  const list = [...(branches ?? [])];
  if (!selected || selected.kind !== kind || list.includes(selected.name)) {
    return list;
  }
  return [selected.name, ...list];
}

const MERGE_BASE_FAILURE_TITLE = "Failed to update merge base";

function showNotReadyToast(
  status: "creating" | "provisioning" | "ready" | "error" | "destroyed",
): void {
  switch (status) {
    case "creating":
    case "provisioning":
      return;
    case "ready":
      toast.warning(MERGE_BASE_FAILURE_TITLE, {
        description: "Workspace is unavailable.",
      });
      return;
    case "error":
      toast.error(MERGE_BASE_FAILURE_TITLE, {
        description: "Workspace setup failed.",
      });
      return;
    case "destroyed":
      toast.warning(MERGE_BASE_FAILURE_TITLE, {
        description: "Workspace no longer exists.",
      });
      return;
  }
}

export interface MergeBaseState {
  effectiveMergeBaseBranch: string | undefined;
  showMergeBase: boolean;
  showBranchComparison: boolean;
  selectedBranchRef: GitBranchRefClassification | null;
  options: readonly string[];
  remoteOptions: readonly string[];
  optionsLoading: boolean;
  optionsLoaded: boolean;
  onChange(branch: string): void;
  onPickerOpenChange(open: boolean): void;
  onSearchQueryChange(query: string): void;
}

export function useMergeBase(
  environmentId: string | null,
  status: WorkspaceStatus | undefined,
  options: { loadOptions?: boolean } = {},
): MergeBaseState {
  const override = useOverride(environmentId);
  const statusBranch = status?.mergeBase?.mergeBaseBranch;
  useEffect(() => {
    if (environmentId !== null && override !== undefined && override === statusBranch) {
      setOverride(environmentId, null);
    }
  }, [environmentId, override, statusBranch]);
  const effectiveMergeBaseBranch =
    override ?? statusBranch ?? status?.branch.defaultBranch;
  const currentBranch = status?.branch.currentBranch ?? null;
  const defaultBranch = status?.branch.defaultBranch;
  const isOnDefaultBranch =
    currentBranch !== null && currentBranch === defaultBranch;
  const showBranchComparison = Boolean(
    effectiveMergeBaseBranch || defaultBranch,
  );
  const [pickerRequested, setPickerRequested] = useState(false);
  const [query, setQuery] = useState("");
  const branches = useGitBranches({
    environmentId,
    query,
    selectedBranch: effectiveMergeBaseBranch,
    enabled: pickerRequested || options.loadOptions === true,
  });
  const selectedBranchRef = branches.data?.selectedBranch ?? null;
  const localOptions = useMemo(
    () =>
      prependSelectedBranch(branches.data?.branches, selectedBranchRef, "local"),
    [branches.data?.branches, selectedBranchRef],
  );
  const remoteOptions = useMemo(
    () =>
      prependSelectedBranch(
        branches.data?.remoteBranches,
        selectedBranchRef,
        "remote",
      ),
    [branches.data?.remoteBranches, selectedBranchRef],
  );
  const setMergeBase = useSetMergeBase();
  const { mutate } = setMergeBase;
  const onChange = useCallback(
    (branch: string) => {
      if (environmentId === null) return;
      const normalized = branch.trim();
      if (normalized.length === 0) return;
      setOverride(environmentId, normalized);
      void mutate({ environmentId, mergeBaseBranch: normalized }).then(
        (result) => {
          if (result.ok) return;
          setOverride(environmentId, null);
          showNotReadyToast(result.environmentStatus);
        },
        (error: unknown) => {
          setOverride(environmentId, null);
          toast.error("Failed to update merge base branch", {
            description: error instanceof Error ? error.message : undefined,
          });
        },
      );
    },
    [environmentId, mutate],
  );
  const onPickerOpenChange = useCallback((open: boolean) => {
    if (open) setPickerRequested(true);
  }, []);
  return {
    effectiveMergeBaseBranch,
    showMergeBase: Boolean(effectiveMergeBaseBranch) && !isOnDefaultBranch,
    showBranchComparison,
    selectedBranchRef,
    options: localOptions,
    remoteOptions,
    optionsLoading: branches.isFetching,
    optionsLoaded: branches.data !== undefined,
    onChange,
    onPickerOpenChange,
    onSearchQueryChange: setQuery,
  };
}
