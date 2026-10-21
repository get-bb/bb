import { coreRead, dependency } from "./core-read";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "@bb/query-changes";
import type {
  EnvironmentChangeKind,
  Environment,
  ThreadPullRequest,
} from "@bb/domain";
import type {
  EnvironmentPullRequestResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import { publicApiRoutes } from "@bb/server-contract";
import type {
  EnvironmentFilePreviewSource,
  FilePreview,
} from "@bb/client-core";
import { loadFilePreview } from "@/lib/api";
import { buildEnvironmentFileContentUrl } from "@/lib/file-content-urls";
import { sdk } from "@/lib/sdk";
import {
  useEnvironmentDetailRealtimeSubscription,
  useEnvironmentPullRequestRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import {
  environmentFilePreviewQueryKey,
  environmentPullRequestQueryKey,
  environmentPathsQueryKey,
  environmentQueryKey,
} from "./query-keys";
import { routeLiveRead } from "./route-changes";
import { requireEnabledQueryArg, type QueryOptions } from "./query-helpers";
import {
  EXPENSIVE_MANUAL_QUERY_POLICY,
  HEAVY_PAYLOAD_QUERY_POLICY,
  TYPEAHEAD_QUERY_POLICY,
} from "./query-policies";

interface EnvironmentQueryOptions extends QueryOptions {
  staleTime?: number;
}

const ENVIRONMENT_PULL_REQUEST_STALE_MS = 30_000;
const ENVIRONMENT_SETTLED_PULL_REQUEST_STALE_MS = 60 * 60_000;

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
    ...coreRead(environmentRecordDependency(environmentId), ({ signal }) =>
      sdk.environments.get({
        environmentId: requireEnvironmentId(environmentId, "useEnvironment"),
        signal,
      }),
    ),
    enabled,
    staleTime: options?.staleTime,
  });
}

export function getEnvironmentPullRequestFromResponse(
  response: EnvironmentPullRequestResponse | undefined,
): ThreadPullRequest | null {
  return response?.outcome === "available" ? response.pullRequest : null;
}

export function getEnvironmentPullRequestStaleTime(
  pullRequest: ThreadPullRequest | null | undefined,
): number {
  return pullRequest?.state === "closed" || pullRequest?.state === "merged"
    ? ENVIRONMENT_SETTLED_PULL_REQUEST_STALE_MS
    : ENVIRONMENT_PULL_REQUEST_STALE_MS;
}

export function useEnvironmentPullRequest(
  environmentId: string | null | undefined,
  options?: QueryOptions,
) {
  const client = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  useEnvironmentPullRequestRealtimeSubscription(environmentId, { enabled });
  const queryKey = environmentPullRequestQueryKey(environmentId);

  return useLiveQuery<EnvironmentPullRequestResponse>({
    queryKey,
    ...routeLiveRead(
      client,
      queryKey,
      publicApiRoutes.environments.pullRequest,
      { params: environmentId ? { id: environmentId } : {}, input: undefined },
      (signal) =>
        sdk.environments.pullRequest({
          environmentId: requireEnvironmentId(
            environmentId,
            "useEnvironmentPullRequest",
          ),
          signal,
        }),
    ),
    enabled,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: (query) =>
      getEnvironmentPullRequestStaleTime(
        getEnvironmentPullRequestFromResponse(query.state.data),
      ),
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
    ...coreRead(
      environmentRecordDependency(environmentId, "work-status-changed"),
      async ({ signal }) => {
        const resolvedPath = requireEnabledQueryArg({
          value: path,
          hookName: "useEnvironmentFilePreview",
          argName: "path",
        });
        const resolvedSource = requireEnabledQueryArg({
          value: source,
          hookName: "useEnvironmentFilePreview",
          argName: "source",
        });
        const resolvedEnvironmentId = requireEnvironmentId(
          environmentId,
          "useEnvironmentFilePreview",
        );
        return loadFilePreview(
          {
            name: resolvedPath.split("/").at(-1),
            path: resolvedPath,
            url: buildEnvironmentFileContentUrl(
              resolvedEnvironmentId,
              resolvedSource,
              resolvedPath,
            ),
          },
          signal,
        );
      },
    ),
    enabled,
    ...EXPENSIVE_MANUAL_QUERY_POLICY,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}

interface UseEnvironmentPathSuggestionsArgs {
  environmentId: string | null | undefined;
  query: string | null;
  limit?: number;
  includeFiles: boolean;
  includeDirectories: boolean;
}

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
      sdk.environments.paths({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentPathSuggestions",
        ),
        query: trimmedQuery,
        limit: String(limit),
        includeFiles: includeFiles ? "true" : "false",
        includeDirectories: includeDirectories ? "true" : "false",
        signal,
      }),
    enabled,
    ...TYPEAHEAD_QUERY_POLICY,
    placeholderData: (previousData) => previousData,
  });
}

const ENVIRONMENT_RECORD_CHANGES: EnvironmentChangeKind[] = [
  "environment-created",
  "environment-deleted",
  "metadata-changed",
  "status-changed",
];

function environmentRecordDependency(
  id: string | null | undefined,
  ...changes: EnvironmentChangeKind[]
) {
  return dependency(
    "environment",
    [...ENVIRONMENT_RECORD_CHANGES, ...changes],
    id ?? undefined,
  );
}
