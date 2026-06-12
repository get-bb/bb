import { useQuery } from "@tanstack/react-query";
import type { ProjectExecutionDefaults } from "@bb/domain";
import { apiClient } from "@/lib/api-server";
import { request } from "@/lib/api";
import { requireEnabledQueryArg } from "./query-helpers";

export const PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY =
  "projectDefaultExecutionOptions";

export type ProjectDefaultExecutionOptionsQueryKey = readonly [
  typeof PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  string,
];

interface QueryOptions {
  enabled?: boolean;
}

interface ProjectDefaultExecutionOptionsQueryKeyArgs {
  projectId: string;
}

interface UseProjectDefaultExecutionOptionsArgs {
  projectId: string | undefined;
}

interface FetchProjectDefaultExecutionOptionsArgs {
  projectId: string;
}

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

export function projectDefaultExecutionOptionsQueryKey({
  projectId,
}: ProjectDefaultExecutionOptionsQueryKeyArgs): ProjectDefaultExecutionOptionsQueryKey {
  return [PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY, projectId];
}

export function fetchProjectDefaultExecutionOptions({
  projectId,
}: FetchProjectDefaultExecutionOptionsArgs): Promise<ProjectExecutionDefaults | null> {
  return request<ProjectExecutionDefaults | null>(
    apiClient.projects[":id"]["default-execution-options"].$get({
      param: { id: projectId },
      query: {},
    }),
  );
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
      fetchProjectDefaultExecutionOptions({
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
