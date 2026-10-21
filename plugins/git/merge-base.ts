import { useEffect, useState } from "react";
import type { Environment } from "@bb/domain";
import type { WorkspaceStatus } from "bb-git-contract";
import { useSdk, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  describeLifecycleError,
  parseLifecycleError,
} from "@bb/core-ui/lifecycle-errors";
import { gitRpcContract } from "./contract.js";
import {
  resolveEffectiveMergeBaseBranch,
  resolvePersistedMergeBaseBranch,
} from "./merge-base-selection.js";

export function useMergeBase(
  environment: Environment | null | undefined,
  workspaceStatus?: WorkspaceStatus,
) {
  const sdk = useSdk();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [pending, setPending] = useState<{
    environmentId: string;
    branch: string;
  } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 120);
    return () => clearTimeout(timer);
  }, [query]);
  const selected = resolveEffectiveMergeBaseBranch({
    environment: environment ?? undefined,
    workspaceStatus,
    selectedMergeBaseBranch:
      pending?.environmentId === environment?.id ? pending?.branch : undefined,
  });
  const branches = experimental_useRpcQuery({
    contract: gitRpcContract,
    method: "branches",
    input: {
      environmentId: environment?.id ?? "",
      query: debouncedQuery,
      selectedBranch: selected ?? null,
      limit: 100,
    },
    enabled: open && environment?.status === "ready",
  });
  return {
    selectedMergeBaseBranch: selected,
    mergeBaseBranchRef: branches.data?.selectedBranch,
    mergeBaseBranchOptions: branches.data?.branches,
    mergeBaseRemoteBranchOptions: branches.data?.remoteBranches,
    isLoadingMergeBaseBranchOptions:
      branches.isFetching || query !== debouncedQuery,
    onMergeBasePickerOpenChange: setOpen,
    onMergeBaseBranchSearchQueryChange: setQuery,
    onMergeBaseBranchChange(branch: string) {
      if (!environment) return;
      const mergeBaseBranch = resolvePersistedMergeBaseBranch({
        branch,
        environment,
        workspaceStatus,
      });
      if (mergeBaseBranch === environment.mergeBaseBranch) return;
      const update = { environmentId: environment.id, branch: branch.trim() };
      setPending(update);
      void sdk.environments
        .update({ environmentId: environment.id, mergeBaseBranch })
        .catch((error: unknown) => {
          const lifecycle = parseLifecycleError(error);
          if (
            lifecycle?.code === "environment_not_ready" &&
            lifecycle.details.environmentStatus === "provisioning"
          )
            return;
          const description = describeLifecycleError({
            error,
            operation: "update_merge_base",
          });
          if (description?.severity === "warning")
            toast.warning(description.title, { description: description.body });
          else if (description)
            toast.error(description.title, { description: description.body });
          else toast.error("Failed to update merge base branch");
        })
        .finally(() =>
          setPending((current) => (current === update ? null : current)),
        );
    },
  };
}
