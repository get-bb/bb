import type { Environment } from "@bb/domain";
import type {
  EnvironmentDiffBranchesResponse,
  EnvironmentPullRequestResponse,
  EnvironmentStatusResponse,
} from "@bb/server-contract";
import { useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  environmentMergeBaseBranchesQueryKey,
  environmentPullRequestQueryKey,
  environmentQueryKey,
  environmentWorkStatusQueryKey,
} from "@/lib/query/query-keys";
import { requireEnabledQueryArg } from "../shared/query-helpers";
import { useEnvironmentDetailRealtimeSubscription } from "../shared/use-realtime-subscription";
import {
  getEnvironmentPullRequestFromResponse,
  getEnvironmentPullRequestRefetchInterval,
  getEnvironmentPullRequestStaleTime,
} from "./pull-request-display";

/**
 * Environment reads (mirror of apps/app/src/hooks/queries/environment-queries.ts
 * for the surfaces mobile has): the record, the workspace status behind the
 * context banner's git row and the header git actions, the pull request
 * lookup, and the merge-base branch candidates. Each holds the
 * `environment-detail` realtime subscription while mounted so the daemon
 * watches the workspace and the bridge invalidates on `work-status-changed`.
 */

interface QueryOptions {
  enabled?: boolean;
}

const MERGE_BASE_BRANCHES_STALE_MS = 30_000;
const MERGE_BASE_BRANCHES_LIMIT = 50;

function requireEnvironmentId(
  environmentId: string | null | undefined,
  hookName: string,
): string {
  return requireEnabledQueryArg({
    value: environmentId,
    hookName,
    argName: "environmentId",
  });
}

export function useEnvironment(
  environmentId: string | null | undefined,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  return useQuery<Environment>({
    queryKey: environmentQueryKey(environmentId ?? ""),
    queryFn: ({ signal }) =>
      sdk.environments.get({
        environmentId: requireEnvironmentId(environmentId, "useEnvironment"),
        signal,
      }),
    enabled,
  });
}

/**
 * `GET /environments/:id/status?mergeBaseBranch=`: working tree, checkout,
 * branch facts, and the merge-base comparison. Realtime owns freshness
 * (`work-status-changed`), so a mount establishes a fresh baseline and the
 * previous merge base's answer stands in while a new one loads.
 */
export function useEnvironmentStatus(
  environmentId: string | null | undefined,
  mergeBaseBranch: string | undefined,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  return useQuery<EnvironmentStatusResponse>({
    queryKey: environmentWorkStatusQueryKey(
      environmentId ?? "",
      mergeBaseBranch ?? null,
    ),
    queryFn: ({ signal }) =>
      sdk.environments.status({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentStatus",
        ),
        ...(mergeBaseBranch ? { mergeBaseBranch } : {}),
        signal,
      }),
    enabled,
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === environmentId ? previousData : undefined,
  });
}

/**
 * `GET /environments/:id/pull-request`: the branch's PR (or "absent" /
 * "unavailable"). Open PRs with pending checks poll every 5 s; settled PRs
 * (merged / closed) stay fresh for an hour.
 */
export function useEnvironmentPullRequest(
  environmentId: string | null | undefined,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  return useQuery<EnvironmentPullRequestResponse>({
    queryKey: environmentPullRequestQueryKey(environmentId ?? ""),
    queryFn: ({ signal }) =>
      sdk.environments.pullRequest({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentPullRequest",
        ),
        signal,
      }),
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      getEnvironmentPullRequestRefetchInterval(
        getEnvironmentPullRequestFromResponse(query.state.data),
      ),
    staleTime: (query) =>
      getEnvironmentPullRequestStaleTime(
        getEnvironmentPullRequestFromResponse(query.state.data),
      ),
  });
}

export interface UseEnvironmentMergeBaseBranchesOptions extends QueryOptions {
  query?: string;
  selectedBranch?: string;
  limit?: number;
}

/** `GET /environments/:id/diff/branches`: merge-base picker candidates. */
export function useEnvironmentMergeBaseBranches(
  environmentId: string | null | undefined,
  options?: UseEnvironmentMergeBaseBranchesOptions,
) {
  const { sdk } = useProfileClient();
  const query = options?.query?.trim() ?? "";
  const selectedBranch = options?.selectedBranch?.trim() ?? "";
  const limit = options?.limit ?? MERGE_BASE_BRANCHES_LIMIT;
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  return useQuery<EnvironmentDiffBranchesResponse>({
    queryKey: environmentMergeBaseBranchesQueryKey(
      environmentId ?? "",
      query,
      limit,
      selectedBranch,
    ),
    queryFn: ({ signal }) =>
      sdk.environments.diffBranches({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentMergeBaseBranches",
        ),
        ...(query ? { query } : {}),
        ...(selectedBranch ? { selectedBranch } : {}),
        limit: String(limit),
        signal,
      }),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: MERGE_BASE_BRANCHES_STALE_MS,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === environmentId ? previousData : undefined,
  });
}
