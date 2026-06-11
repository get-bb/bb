import { useQuery } from "@tanstack/react-query";
import type { ProjectExecutionDefaults } from "@bb/domain";
import type {
  CommandListResponse,
  ProjectBranchesResponse,
  ProjectWithThreadsResponse,
  PromptHistoryResponse,
  SidebarBootstrapResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  projectCommandsQueryKey,
  projectDefaultExecutionOptionsQueryKey,
  projectPathsQueryKey,
  projectPromptHistoryQueryKey,
  projectSourceBranchesQueryKey,
  sidebarNavigationQueryKey,
} from "./query-keys";
import { resolveProjectSourceBranchesPlaceholder } from "./query-placeholders";
import {
  PROMPT_HISTORY_STALE_TIME_MS,
  requireEnabledQueryArg,
} from "./query-helpers";

interface QueryOptions {
  enabled?: boolean;
}

interface BranchQueryOptions extends QueryOptions {
  limit?: number;
  query?: string;
  selectedBranch?: string;
}

interface UseProjectDefaultExecutionOptionsArgs {
  projectId: string | undefined;
}

interface UseProjectPathSuggestionsArgs {
  projectId: string | undefined;
  query: string | null;
  limit?: number;
  includeFiles: boolean;
  includeDirectories: boolean;
}

interface UseProjectCommandsArgs {
  projectId: string | undefined;
  providerId: string | undefined;
  environmentId: string | null;
  query: string;
  limit: number;
}

const PROJECT_SOURCE_BRANCHES_STALE_TIME_MS = 5_000;
const PROJECT_SOURCE_BRANCHES_LIMIT = 50;

function requireProjectId(
  projectId: string | undefined,
  hookName: string,
): string {
  return requireEnabledQueryArg({
    value: projectId,
    hookName,
    argName: "projectId",
  });
}

function requireProviderId(
  providerId: string | undefined,
  hookName: string,
): string {
  return requireEnabledQueryArg({
    value: providerId,
    hookName,
    argName: "providerId",
  });
}

export type SidebarProject = Omit<ProjectWithThreadsResponse, "threads">;

export function stripProjectThreads(
  project: ProjectWithThreadsResponse,
): SidebarProject {
  const { threads, ...rest } = project;
  return rest;
}

export function useSidebarNavigation(options?: QueryOptions) {
  return useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => api.listProjectsWithThreads(signal),
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
  });
}

export function useProjectSourceBranches(
  projectId: string | undefined,
  hostId: string | null,
  options?: BranchQueryOptions,
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(projectId) && Boolean(hostId);
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
    queryFn: () =>
      api.getProjectSourceBranches(
        requireProjectId(projectId, "useProjectSourceBranches"),
        hostId ?? "",
        {
          ...(query ? { query } : {}),
          ...(selectedBranch ? { selectedBranch } : {}),
          limit,
        },
      ),
    enabled,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: PROJECT_SOURCE_BRANCHES_STALE_TIME_MS,
    placeholderData: (previousData, previousQuery) =>
      projectId && hostId
        ? resolveProjectSourceBranchesPlaceholder({
            previousData,
            previousQueryKey: previousQuery?.queryKey,
            projectId,
            hostId,
            limit,
            selectedBranch,
          })
        : undefined,
  });
}

export function useProjectPromptHistory(
  projectId: string | undefined,
  options?: QueryOptions,
) {
  return useQuery<PromptHistoryResponse>({
    queryKey: projectPromptHistoryQueryKey(projectId),
    queryFn: ({ signal }) =>
      api.listProjectPromptHistory(
        requireProjectId(projectId, "useProjectPromptHistory"),
        signal,
      ),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
    staleTime: PROMPT_HISTORY_STALE_TIME_MS,
  });
}

export function useProjectDefaultExecutionOptions(
  args: UseProjectDefaultExecutionOptionsArgs,
  options?: QueryOptions,
) {
  const { projectId } = args;
  return useQuery<ProjectExecutionDefaults | null>({
    queryKey: projectDefaultExecutionOptionsQueryKey({
      projectId: projectId ?? "",
    }),
    queryFn: () =>
      api.getProjectDefaultExecutionOptions({
        projectId: requireProjectId(
          projectId,
          "useProjectDefaultExecutionOptions",
        ),
      }),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
    staleTime: 10_000,
    placeholderData: (previousData) => (projectId ? previousData : undefined),
  });
}

export function useProjectPathSuggestions(args: UseProjectPathSuggestionsArgs) {
  const {
    projectId,
    query,
    limit = 8,
    includeFiles,
    includeDirectories,
  } = args;
  const trimmedQuery = query?.trim() ?? "";

  return useQuery<WorkspacePathListResponse>({
    queryKey: projectPathsQueryKey(
      projectId,
      trimmedQuery,
      limit,
      includeFiles,
      includeDirectories,
    ),
    queryFn: () =>
      api.searchProjectPaths({
        projectId: projectId ?? "",
        query: trimmedQuery,
        limit,
        includeFiles,
        includeDirectories,
      }),
    enabled: Boolean(projectId) && trimmedQuery.length > 0,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Fetches the discoverable provider skills/commands for a project, scoped by
 * provider + environment. Backs `useCommandSuggestions`, which owns trigger
 * resolution, debounce, and mapping to menu rows, and serves both the
 * existing-thread follow-up composer and the new-thread composer. Unlike
 * mentions, the command list is enabled even with an empty query (commands show
 * the full list on `/`/`$`); the caller gates fetching via `options.enabled`.
 */
export function useProjectCommands(
  args: UseProjectCommandsArgs,
  options?: QueryOptions,
) {
  return useQuery<CommandListResponse>({
    queryKey: projectCommandsQueryKey(
      args.projectId,
      args.providerId,
      args.environmentId,
      args.query,
    ),
    queryFn: () =>
      api.listProjectCommands({
        projectId: requireProjectId(args.projectId, "useProjectCommands"),
        providerId: requireProviderId(args.providerId, "useProjectCommands"),
        environmentId: args.environmentId,
        query: args.query,
        limit: args.limit,
      }),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(args.projectId) &&
      Boolean(args.providerId),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}
