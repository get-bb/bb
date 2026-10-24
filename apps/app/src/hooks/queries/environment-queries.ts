import { useQuery } from "@tanstack/react-query";
import type {
  Environment,
  WorkspaceDiffTarget,
  GitBranchOptions,
} from "@bb/domain";
import type { WorkspacePathListResponse } from "@bb/server-contract";
import type { EnvironmentDiffArgs } from "@bb/sdk/browser";
import type {
  EnvironmentFilePreviewSource,
  FilePreview,
} from "@bb/client-core";
import { loadFilePreview } from "@/lib/api";
import { buildEnvironmentFileContentUrl } from "@/lib/file-content-urls";
import { sdk } from "@/lib/sdk";
import { useEnvironmentDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  environmentDiffFilesQueryKey,
  environmentDiffTargetKey,
  environmentDiffViewedQueryKey,
  environmentFilePreviewQueryKey,
  environmentMergeBaseBranchesQueryKey,
  environmentPathsQueryKey,
  environmentQueryKey,
  environmentWorkStatusQueryKey,
} from "./query-keys";
import { useDebouncedBranchSearchQuery } from "./branch-search-debounce";
import { gitPluginReads, useGitPluginWatch } from "./git-plugin-reads";
import {
  resolveEnvironmentDiffFilesPlaceholder,
  resolveEnvironmentMergeBaseBranchesPlaceholder,
  resolveEnvironmentWorkStatusPlaceholder,
} from "./query-placeholders";
import { requireEnabledQueryArg, type QueryOptions } from "./query-helpers";
import {
  EXPENSIVE_MANUAL_QUERY_POLICY,
  HEAVY_PAYLOAD_QUERY_POLICY,
  REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
  TYPEAHEAD_QUERY_POLICY,
} from "./query-policies";
import type {
  GitFilesResult,
  GitStatusResult,
} from "bb-plugin-bb--git/contract";

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
  ignoreWhitespace: boolean;
}

const MERGE_BASE_BRANCHES_STALE_MS = 30_000;
const MERGE_BASE_BRANCHES_LIMIT = 50;
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
      sdk.environments.get({
        environmentId: requireEnvironmentId(environmentId, "useEnvironment"),
        signal,
      }),
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
  useGitPluginWatch(environmentId, enabled);

  return useQuery<GitStatusResult>({
    queryKey: environmentWorkStatusQueryKey(
      environmentId,
      normalizedMergeBaseBranch,
    ),
    queryFn: ({ signal }) =>
      gitPluginReads.workspaceStatus(
        {
          environmentId: requireEnvironmentId(
            environmentId,
            "useEnvironmentWorkStatus",
          ),
          ...(mergeBaseBranch === undefined ? {} : { mergeBaseBranch }),
        },
        signal,
      ),
    enabled,
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
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

export function useEnvironmentMergeBaseBranches(
  environmentId: string,
  options?: BranchQueryOptions,
) {
  const query = useDebouncedBranchSearchQuery(options?.query?.trim() ?? "");
  const selectedBranch = options?.selectedBranch?.trim();
  const limit = options?.limit ?? MERGE_BASE_BRANCHES_LIMIT;
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  useGitPluginWatch(environmentId, enabled);
  return useQuery<GitBranchOptions>({
    queryKey: environmentMergeBaseBranchesQueryKey(
      environmentId,
      query,
      limit,
      selectedBranch ?? "",
    ),
    queryFn: ({ signal }) =>
      gitPluginReads.branches(
        {
          environmentId,
          ...(query ? { query } : {}),
          ...(selectedBranch ? { selectedBranch } : {}),
          limit,
        },
        signal,
      ),
    enabled,
    ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
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
    queryFn: async ({ signal }) => {
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

export function useEnvironmentDiffFiles(
  environmentId: string,
  options: UseEnvironmentDiffFilesOptions,
) {
  const { target, ignoreWhitespace } = options;
  const enabled =
    (options.enabled ?? true) && Boolean(environmentId) && target !== undefined;
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  useGitPluginWatch(environmentId, enabled);

  return useQuery<GitFilesResult>({
    queryKey: environmentDiffFilesQueryKey(
      environmentId,
      target?.type ?? null,
      environmentDiffTargetKey(target),
      ignoreWhitespace,
    ),
    queryFn: ({ signal }) =>
      gitPluginReads.files(
        {
          environmentId,
          target: requireEnabledQueryArg({
            value: target,
            hookName: "useEnvironmentDiffFiles",
            argName: "target",
          }),
          ignoreWhitespace,
        },
        signal,
      ),
    enabled,
    placeholderData: (previousData, previousQuery) =>
      resolveEnvironmentDiffFilesPlaceholder(
        previousData,
        previousQuery?.queryKey,
        environmentId,
      ),
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
    staleTime: ENVIRONMENT_DIFF_STALE_MS,
  });
}

export function useEnvironmentDiffViewed(
  environmentId: string,
  options: {
    target?: WorkspaceDiffTarget;
    enabled: boolean;
    paths: readonly string[];
  },
) {
  const { target } = options;
  const paths = [...new Set(options.paths)].sort();
  const enabled =
    options.enabled &&
    Boolean(environmentId) &&
    target !== undefined &&
    paths.length > 0;
  return useQuery({
    queryKey: environmentDiffViewedQueryKey(
      environmentId,
      target?.type ?? null,
      environmentDiffTargetKey(target),
      paths,
    ),
    queryFn: ({ signal }) =>
      sdk.environments.experimental_diffViewed({
        ...buildEnvironmentDiffArgs(
          environmentId,
          requireEnabledQueryArg({
            value: target,
            hookName: "useEnvironmentDiffViewed",
            argName: "target",
          }),
        ),
        signal,
        paths,
      }),
    enabled,
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  });
}

function buildEnvironmentDiffArgs(
  environmentId: string,
  target: WorkspaceDiffTarget,
): EnvironmentDiffArgs {
  switch (target.type) {
    case "uncommitted":
      return { environmentId, target: target.type };
    case "branch_committed":
    case "all":
      return {
        environmentId,
        mergeBaseBranch: target.mergeBaseBranch,
        target: target.type,
      };
    case "commit":
      return { environmentId, sha: target.sha, target: target.type };
  }
}
