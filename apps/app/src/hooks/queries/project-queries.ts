import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  CommandListResponse,
  ProjectBranchesResponse,
  ProjectWithThreadsResponse,
  PromptHistoryResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { useProjectDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  projectCommandsQueryKey,
  projectCommandsPagesQueryKey,
  projectPathsQueryKey,
  projectPromptHistoryQueryKey,
  projectSourceBranchesQueryKey,
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
  offset: number;
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

export function useProjectSourceBranches(
  projectId: string | undefined,
  hostId: string | null,
  options?: BranchQueryOptions,
) {
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
      api.getProjectSourceBranches(
        requireProjectId(projectId, "useProjectSourceBranches"),
        hostId ?? "",
        {
          ...(query ? { query } : {}),
          ...(selectedBranch ? { selectedBranch } : {}),
          limit,
        },
        signal,
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
  const enabled = (options?.enabled ?? true) && Boolean(projectId);
  useProjectDetailRealtimeSubscription(projectId, { enabled });

  return useQuery<PromptHistoryResponse>({
    queryKey: projectPromptHistoryQueryKey(projectId),
    queryFn: ({ signal }) =>
      api.listProjectPromptHistory(
        requireProjectId(projectId, "useProjectPromptHistory"),
        signal,
      ),
    enabled,
    staleTime: PROMPT_HISTORY_STALE_TIME_MS,
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
  const enabled = Boolean(projectId) && trimmedQuery.length > 0;
  useProjectDetailRealtimeSubscription(projectId, { enabled });

  return useQuery<WorkspacePathListResponse>({
    queryKey: projectPathsQueryKey(
      projectId,
      trimmedQuery,
      limit,
      includeFiles,
      includeDirectories,
    ),
    queryFn: ({ signal }) =>
      api.searchProjectPaths({
        projectId: projectId ?? "",
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
 * Fetches the discoverable provider skills/commands for a project, scoped by
 * provider + environment. Backs `useCommandSuggestions`, which owns trigger
 * resolution, debounce, and mapping to menu rows, and serves both the
 * existing-thread follow-up composer and the new-thread composer. Unlike
 * mentions, the command list is enabled even with an empty query (commands show
 * the full list on `/`); the caller gates fetching via `options.enabled`.
 */
export function useProjectCommands(
  args: UseProjectCommandsArgs,
  options?: QueryOptions,
) {
  const enabled =
    (options?.enabled ?? true) &&
    Boolean(args.projectId) &&
    Boolean(args.providerId);
  useProjectDetailRealtimeSubscription(args.projectId, { enabled });

  return useQuery<CommandListResponse>({
    queryKey: projectCommandsQueryKey(
      args.projectId,
      args.providerId,
      args.environmentId,
      args.query,
      args.offset,
      args.limit,
    ),
    queryFn: ({ signal }) =>
      api.listProjectCommands({
        projectId: requireProjectId(args.projectId, "useProjectCommands"),
        providerId: requireProviderId(args.providerId, "useProjectCommands"),
        environmentId: args.environmentId,
        query: args.query,
        limit: args.limit,
        offset: args.offset,
        signal,
      }),
    enabled,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}

export function useProjectCommandsPages(
  args: Omit<UseProjectCommandsArgs, "offset">,
  options?: QueryOptions,
) {
  return useInfiniteQuery({
    queryKey: projectCommandsPagesQueryKey(
      args.projectId,
      args.providerId,
      args.environmentId,
      args.query,
      args.limit,
    ),
    queryFn: ({ pageParam, signal }) =>
      api.listProjectCommands({
        projectId: requireProjectId(args.projectId, "useProjectCommandsPages"),
        providerId: requireProviderId(
          args.providerId,
          "useProjectCommandsPages",
        ),
        environmentId: args.environmentId,
        query: args.query,
        limit: args.limit,
        offset: pageParam,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.truncated ? lastPageParam + args.limit : undefined,
    enabled:
      (options?.enabled ?? true) &&
      Boolean(args.projectId) &&
      Boolean(args.providerId),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
