import type { ProjectExecutionDefaults } from "@bb/domain";
import type {
  ProjectBranchesResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import { useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  projectDefaultExecutionOptionsQueryKey,
  projectPathsQueryKey,
  projectSourceBranchesQueryKey,
} from "@/lib/query/query-keys";
import { requireEnabledQueryArg } from "../shared/query-helpers";
import {
  FAST_FOCUS_OWNED_LIVE_QUERY_POLICY,
  TYPEAHEAD_QUERY_POLICY,
} from "../shared/query-policies";
import { useProjectDetailRealtimeSubscription } from "../shared/use-realtime-subscription";

interface QueryOptions {
  enabled?: boolean;
}

const PROJECT_SOURCE_BRANCHES_LIMIT = 50;

export interface UseProjectBranchesOptions extends QueryOptions {
  query?: string;
  limit?: number;
  /** Always include this branch even when it falls outside `limit`. */
  selectedBranch?: string;
}

/**
 * Branches of the project's checkout on a host (`GET /projects/:id/branches`):
 * current checkout, default branch, the worktree base branch default, and a
 * filtered branch list for the branch picker.
 */
export function useProjectBranches(
  projectId: string | undefined,
  hostId: string | null | undefined,
  options?: UseProjectBranchesOptions,
) {
  const { sdk } = useProfileClient();
  const enabled =
    (options?.enabled ?? true) && Boolean(projectId) && Boolean(hostId);
  useProjectDetailRealtimeSubscription(projectId, { enabled });
  const query = options?.query?.trim() ?? "";
  const limit = options?.limit ?? PROJECT_SOURCE_BRANCHES_LIMIT;
  const selectedBranch = options?.selectedBranch?.trim() ?? "";
  return useQuery<ProjectBranchesResponse>({
    queryKey: projectSourceBranchesQueryKey(
      projectId ?? "",
      hostId ?? "",
      query,
      limit,
      selectedBranch,
    ),
    queryFn: ({ signal }) =>
      sdk.projects.branches({
        projectId: requireEnabledQueryArg({
          value: projectId,
          hookName: "useProjectBranches",
          argName: "projectId",
        }),
        hostId: requireEnabledQueryArg({
          value: hostId,
          hookName: "useProjectBranches",
          argName: "hostId",
        }),
        ...(query ? { query } : {}),
        ...(selectedBranch ? { selectedBranch } : {}),
        limit: String(limit),
        signal,
      }),
    enabled,
    ...FAST_FOCUS_OWNED_LIVE_QUERY_POLICY,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * The server-resolved provider/model/reasoning/permission/tier defaults for
 * a new root thread in a project (`GET /projects/:id/default-execution-options`).
 * `null` when the server cannot form concrete defaults. The sidebar bootstrap
 * inlines the same value per project (`defaultExecutionOptions`).
 */
export function useProjectDefaultExecutionOptions(
  projectId: string | undefined,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && Boolean(projectId);
  useProjectDetailRealtimeSubscription(projectId, { enabled });
  return useQuery<ProjectExecutionDefaults | null>({
    queryKey: projectDefaultExecutionOptionsQueryKey(projectId ?? ""),
    queryFn: ({ signal }) =>
      sdk.projects.defaultExecutionOptions({
        projectId: requireEnabledQueryArg({
          value: projectId,
          hookName: "useProjectDefaultExecutionOptions",
          argName: "projectId",
        }),
        signal,
      }),
    enabled,
    staleTime: 10_000,
    placeholderData: (previousData) => (projectId ? previousData : undefined),
  });
}

export interface UseProjectPathsArgs {
  projectId: string | undefined;
  /** Route through an environment's workspace, an explicit host, or the primary host. */
  environmentId?: string | null;
  hostId?: string | null;
  query: string | null;
  limit?: number;
  includeFiles?: boolean;
  includeDirectories?: boolean;
}

/**
 * Fuzzy path suggestions inside the project workspace
 * (`GET /projects/:id/paths`) for path mentions and the unmanaged-path field.
 * Disabled until the query is non-empty; the previous suggestions stay while
 * the next keystroke resolves.
 */
export function useProjectPaths({
  projectId,
  environmentId = null,
  hostId = null,
  query,
  limit = 8,
  includeFiles = true,
  includeDirectories = true,
}: UseProjectPathsArgs) {
  const { sdk } = useProfileClient();
  const trimmedQuery = query?.trim() ?? "";
  const enabled = Boolean(projectId) && trimmedQuery.length > 0;
  useProjectDetailRealtimeSubscription(projectId, { enabled });
  return useQuery<WorkspacePathListResponse>({
    queryKey: projectPathsQueryKey(
      projectId ?? "",
      environmentId,
      hostId,
      trimmedQuery,
      limit,
      includeFiles,
      includeDirectories,
    ),
    queryFn: ({ signal }) =>
      sdk.projects.paths({
        projectId: requireEnabledQueryArg({
          value: projectId,
          hookName: "useProjectPaths",
          argName: "projectId",
        }),
        query: trimmedQuery,
        limit: String(limit),
        includeFiles: includeFiles ? "true" : "false",
        includeDirectories: includeDirectories ? "true" : "false",
        signal,
        ...(environmentId !== null
          ? { environmentId }
          : hostId !== null
            ? { hostId }
            : {}),
      }),
    enabled,
    ...TYPEAHEAD_QUERY_POLICY,
    placeholderData: (previousData) => previousData,
  });
}
