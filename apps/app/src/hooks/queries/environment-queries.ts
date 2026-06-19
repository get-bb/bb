import { useQuery } from "@tanstack/react-query";
import type {
  Environment,
  ThreadPullRequest,
  WorkspaceDiffTarget,
} from "@bb/domain";
import type {
  EnvironmentDiffBranchesResponse,
  EnvironmentDiffFilesResponse,
  EnvironmentPullRequestResponse,
  EnvironmentStatusResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import type { FilePreview } from "@/lib/api";
import type { EnvironmentFilePreviewSource } from "@/lib/file-preview";
import * as api from "@/lib/api";
import { useEnvironmentDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  environmentDiffFilesQueryKey,
  environmentDiffTargetKey,
  environmentFilePreviewQueryKey,
  environmentMergeBaseBranchesQueryKey,
  environmentPullRequestQueryKey,
  environmentPathsQueryKey,
  environmentQueryKey,
  environmentWorkStatusQueryKey,
} from "./query-keys";
import {
  resolveEnvironmentDiffFilesPlaceholder,
  resolveEnvironmentMergeBaseBranchesPlaceholder,
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

interface UseEnvironmentDiffFilesOptions extends QueryOptions {
  target?: WorkspaceDiffTarget;
}

const ENVIRONMENT_PULL_REQUEST_STALE_MS = 30_000;
const ENVIRONMENT_SETTLED_PULL_REQUEST_STALE_MS = 60 * 60_000;
const ENVIRONMENT_ACTIVE_PULL_REQUEST_REFETCH_MS = 5_000;
const MERGE_BASE_BRANCHES_STALE_MS = 30_000;
const MERGE_BASE_BRANCHES_LIMIT = 50;
/** Staleness window for the environment diff TOC query. */
const ENVIRONMENT_DIFF_STALE_MS = 5_000;

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
    queryFn: ({ signal }) =>
      api.getEnvironment(
        requireEnvironmentId(environmentId, "useEnvironment"),
        signal,
      ),
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
    queryFn: ({ signal }) =>
      api.getEnvironmentWorkStatus(
        requireEnvironmentId(environmentId, "useEnvironmentWorkStatus"),
        mergeBaseBranch,
        signal,
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

export function getEnvironmentPullRequestStaleTime(
  pullRequest: ThreadPullRequest | null | undefined,
): number {
  return pullRequest?.state === "closed" || pullRequest?.state === "merged"
    ? ENVIRONMENT_SETTLED_PULL_REQUEST_STALE_MS
    : ENVIRONMENT_PULL_REQUEST_STALE_MS;
}

export function getEnvironmentPullRequestRefetchInterval(
  pullRequest: ThreadPullRequest | null | undefined,
): number | false {
  if (!pullRequest || pullRequest.state !== "open") {
    return false;
  }
  if (
    pullRequest.checks.state === "pending" ||
    pullRequest.mergeability.state === "unknown"
  ) {
    return ENVIRONMENT_ACTIVE_PULL_REQUEST_REFETCH_MS;
  }
  return false;
}

export function useEnvironmentPullRequest(
  environmentId: string | null | undefined,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<EnvironmentPullRequestResponse>({
    queryKey: environmentPullRequestQueryKey(environmentId),
    queryFn: ({ signal }) =>
      api.getEnvironmentPullRequest(
        requireEnvironmentId(environmentId, "useEnvironmentPullRequest"),
        signal,
      ),
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      getEnvironmentPullRequestRefetchInterval(query.state.data?.pullRequest),
    staleTime: (query) =>
      getEnvironmentPullRequestStaleTime(query.state.data?.pullRequest),
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
    queryFn: ({ signal }) =>
      api.getEnvironmentDiffBranches(
        environmentId,
        {
          ...(query ? { query } : {}),
          ...(selectedBranch ? { selectedBranch } : {}),
          limit,
        },
        signal,
      ),
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
    queryFn: ({ signal }) =>
      api.searchEnvironmentPaths({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentPathSuggestions",
        ),
        query: trimmedQuery,
        limit,
        includeFiles,
        includeDirectories,
        signal,
      }),
    enabled,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Loads the diff tab's table of contents (one {@link DiffFileEntry} per changed
 * file, no patch text). Patches for visible rows are fetched separately and on
 * demand by {@link useEnvironmentDiffPatches}.
 */
export function useEnvironmentDiffFiles(
  environmentId: string,
  options: UseEnvironmentDiffFilesOptions,
) {
  const target = options.target;
  const enabled =
    (options.enabled ?? true) && Boolean(environmentId) && target !== undefined;
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<EnvironmentDiffFilesResponse>({
    queryKey: environmentDiffFilesQueryKey(
      environmentId,
      target?.type ?? null,
      environmentDiffTargetKey(target),
    ),
    queryFn: ({ signal }) =>
      api.getEnvironmentDiffFiles(
        environmentId,
        requireEnabledQueryArg({
          value: target,
          hookName: "useEnvironmentDiffFiles",
          argName: "target",
        }),
        signal,
      ),
    enabled,
    placeholderData: (previousData, previousQuery) =>
      resolveEnvironmentDiffFilesPlaceholder(
        previousData,
        previousQuery?.queryKey,
        environmentId,
      ),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    staleTime: ENVIRONMENT_DIFF_STALE_MS,
  });
}
