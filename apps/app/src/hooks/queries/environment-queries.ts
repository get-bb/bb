import { useQuery } from "@tanstack/react-query";
import type { Environment, WorkspaceDiffTarget } from "@bb/domain";
import type {
  EnvironmentDiffBranchesResponse,
  EnvironmentDiffResponse,
  EnvironmentPullRequestResponse,
  EnvironmentStatusResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import type { FilePreview } from "@/lib/api";
import type { EnvironmentFilePreviewSource } from "@/lib/file-preview";
import * as api from "@/lib/api";
import { useEnvironmentDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  environmentFilePreviewQueryKey,
  environmentGitDiffQueryKey,
  environmentMergeBaseBranchesQueryKey,
  environmentPullRequestQueryKey,
  environmentPathsQueryKey,
  environmentQueryKey,
  environmentWorkStatusQueryKey,
} from "./query-keys";
import {
  resolveEnvironmentMergeBaseBranchesPlaceholder,
  resolveEnvironmentGitDiffPlaceholder,
  resolveEnvironmentWorkStatusPlaceholder,
} from "./query-placeholders";
import { requireEnabledQueryArg } from "./query-helpers";

interface QueryOptions {
  enabled?: boolean;
}

interface EnvironmentQueryOptions extends QueryOptions {
  staleTime?: number;
}

interface BranchQueryOptions extends QueryOptions {
  limit?: number;
  query?: string;
  selectedBranch?: string;
}

interface UseEnvironmentGitDiffOptions extends QueryOptions {
  target?: WorkspaceDiffTarget;
}

const ENVIRONMENT_PULL_REQUEST_STALE_MS = 30_000;
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
  options?: EnvironmentQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<Environment>({
    queryKey: environmentQueryKey(environmentId),
    queryFn: () =>
      api.getEnvironment(requireEnvironmentId(environmentId, "useEnvironment")),
    enabled,
    staleTime: options?.staleTime,
  });
}

export function useEnvironmentWorkStatus(
  environmentId: string | null | undefined,
  mergeBaseBranch?: string,
  options?: QueryOptions,
) {
  const normalizedMergeBaseBranch = mergeBaseBranch ?? null;
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<EnvironmentStatusResponse>({
    queryKey: environmentWorkStatusQueryKey(
      environmentId,
      normalizedMergeBaseBranch,
    ),
    queryFn: () =>
      api.getEnvironmentWorkStatus(
        requireEnvironmentId(environmentId, "useEnvironmentWorkStatus"),
        mergeBaseBranch,
      ),
    enabled,
    // Subscriptions can be absent while no UI is listening, so remount must
    // establish a fresh baseline instead of trusting cached data.
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    staleTime: 0,
    placeholderData: (previousData, previousQuery) =>
      environmentId
        ? resolveEnvironmentWorkStatusPlaceholder(
            previousData,
            previousQuery?.queryKey,
            environmentId,
          )
        : undefined,
  });
}

export function useEnvironmentPullRequest(
  environmentId: string | null | undefined,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<EnvironmentPullRequestResponse>({
    queryKey: environmentPullRequestQueryKey(environmentId),
    queryFn: () =>
      api.getEnvironmentPullRequest(
        requireEnvironmentId(environmentId, "useEnvironmentPullRequest"),
      ),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: ENVIRONMENT_PULL_REQUEST_STALE_MS,
  });
}

export function useEnvironmentMergeBaseBranches(
  environmentId: string,
  options?: BranchQueryOptions,
) {
  const query = options?.query?.trim() ?? "";
  const selectedBranch = options?.selectedBranch?.trim();
  const limit = options?.limit ?? MERGE_BASE_BRANCHES_LIMIT;
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  return useQuery<EnvironmentDiffBranchesResponse>({
    queryKey: environmentMergeBaseBranchesQueryKey(
      environmentId,
      query,
      limit,
      selectedBranch ?? "",
    ),
    queryFn: () =>
      api.getEnvironmentDiffBranches(environmentId, {
        ...(query ? { query } : {}),
        ...(selectedBranch ? { selectedBranch } : {}),
        limit,
      }),
    enabled,
    refetchOnWindowFocus: false,
    staleTime: MERGE_BASE_BRANCHES_STALE_MS,
    placeholderData: (previousData, previousQuery) =>
      environmentId
        ? resolveEnvironmentMergeBaseBranchesPlaceholder({
            previousData,
            previousQueryKey: previousQuery?.queryKey,
            environmentId,
            limit,
            selectedBranch: selectedBranch ?? "",
          })
        : undefined,
  });
}

export function useEnvironmentFilePreview(
  environmentId: string | null | undefined,
  path: string | null,
  source: EnvironmentFilePreviewSource | null,
  options?: QueryOptions,
) {
  const enabled =
    (options?.enabled ?? true) &&
    Boolean(environmentId) &&
    Boolean(path) &&
    source !== null;
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<FilePreview>({
    queryKey: environmentFilePreviewQueryKey(environmentId, path, source),
    queryFn: ({ signal }) =>
      api.getEnvironmentFilePreview({
        id: requireEnvironmentId(environmentId, "useEnvironmentFilePreview"),
        path: requireEnabledQueryArg({
          value: path,
          hookName: "useEnvironmentFilePreview",
          argName: "path",
        }),
        source: requireEnabledQueryArg({
          value: source,
          hookName: "useEnvironmentFilePreview",
          argName: "source",
        }),
        signal,
      }),
    enabled,
    refetchOnWindowFocus: false,
  });
}

interface UseEnvironmentPathSuggestionsArgs {
  environmentId: string | null | undefined;
  query: string | null;
  limit?: number;
  includeFiles: boolean;
  includeDirectories: boolean;
}

/**
 * Search a thread environment's workspace for path suggestions. Project-agnostic
 * — the canonical workspace path search once a thread has an environment, used
 * for both file mentions and the new-tab file picker.
 */
export function useEnvironmentPathSuggestions(
  args: UseEnvironmentPathSuggestionsArgs,
) {
  const {
    environmentId,
    query,
    limit = 8,
    includeFiles,
    includeDirectories,
  } = args;
  const trimmedQuery = query?.trim() ?? "";
  const enabled = Boolean(environmentId) && trimmedQuery.length > 0;
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<WorkspacePathListResponse>({
    queryKey: environmentPathsQueryKey(
      environmentId ?? undefined,
      trimmedQuery,
      limit,
      includeFiles,
      includeDirectories,
    ),
    queryFn: () =>
      api.searchEnvironmentPaths({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentPathSuggestions",
        ),
        query: trimmedQuery,
        limit,
        includeFiles,
        includeDirectories,
      }),
    enabled,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}

export function useEnvironmentGitDiff(
  environmentId: string,
  options: UseEnvironmentGitDiffOptions,
) {
  const target = options.target;
  const targetKey =
    target?.type === "commit"
      ? target.sha
      : target?.type === "all" || target?.type === "branch_committed"
        ? target.mergeBaseBranch
        : null;
  const enabled =
    (options.enabled ?? true) && Boolean(environmentId) && target !== undefined;
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<EnvironmentDiffResponse>({
    queryKey: environmentGitDiffQueryKey(
      environmentId,
      target?.type ?? null,
      targetKey,
    ),
    queryFn: () =>
      api.getEnvironmentDiff(
        environmentId,
        requireEnabledQueryArg({
          value: target,
          hookName: "useEnvironmentGitDiff",
          argName: "target",
        }),
      ),
    enabled,
    placeholderData: (previousData, previousQuery) =>
      resolveEnvironmentGitDiffPlaceholder(
        previousData,
        previousQuery?.queryKey,
        environmentId,
      ),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  });
}
