import { useCallback, useMemo } from "react";
import type { Host, ThreadListEntry } from "@bb/domain";
import { useProjectWorktrees } from "@/hooks/queries/project-queries";
import { buildReuseThreadOptions } from "./reuse-options";

const WORKTREE_DISCOVERY_REQUEST_FAILURE = {
  hostId: "",
  code: "discovery_failed",
  message: "Worktree discovery failed",
} as const;

interface UseReuseEnvironmentOptionsArgs {
  projectId: string | undefined;
  threads: readonly ThreadListEntry[] | undefined;
  navigationSettled: boolean;
  hosts: readonly Host[];
}

export function useReuseEnvironmentOptions({
  projectId,
  threads,
  navigationSettled,
  hosts,
}: UseReuseEnvironmentOptionsArgs) {
  const enabled = projectId !== undefined && navigationSettled;
  const query = useProjectWorktrees(projectId, { enabled });
  const hostNameById = useMemo(
    () =>
      hosts.length <= 1
        ? null
        : new Map(hosts.map((host) => [host.id, host.name])),
    [hosts],
  );
  const { data, isError, refetch } = query;
  const model = useMemo(
    () =>
      buildReuseThreadOptions({
        threads: threads ?? [],
        worktrees: data?.worktrees ?? [],
        failures: isError
          ? [WORKTREE_DISCOVERY_REQUEST_FAILURE]
          : (data?.failures ?? []),
        hostNameById,
      }),
    [threads, data, isError, hostNameById],
  );
  const loading =
    (threads === undefined && !navigationSettled) ||
    (enabled && query.isPending);
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const hasFailures = model.failures.length > 0;
  return {
    ...model,
    loading,
    hasFailures,
    disabled: !loading && model.options.length === 0 && !hasFailures,
    retry,
  };
}
