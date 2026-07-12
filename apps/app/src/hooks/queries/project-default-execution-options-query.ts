import { useQuery } from "@tanstack/react-query";
import type { ProjectExecutionDefaults } from "@bb/domain";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";
import { useProjectDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { requireEnabledQueryArg } from "./query-helpers";
import { projectDefaultExecutionOptionsQueryKey } from "./query-keys";

interface QueryOptions {
  enabled?: boolean;
}

interface UseProjectDefaultExecutionOptionsArgs {
  projectId: string | undefined;
}

interface FetchProjectDefaultExecutionOptionsArgs {
  projectId: string;
  signal?: AbortSignal;
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

function fetchProjectDefaultExecutionOptions({
  projectId,
  signal,
}: FetchProjectDefaultExecutionOptionsArgs): Promise<ProjectExecutionDefaults | null> {
  return request<ProjectExecutionDefaults | null>(
    apiClient.projects[":id"]["default-execution-options"].$get(
      {
        param: { id: projectId },
        query: {},
      },
      requestOptions(signal),
    ),
  );
}

export function useProjectDefaultExecutionOptions(
  args: UseProjectDefaultExecutionOptionsArgs,
  options?: QueryOptions,
) {
  const { projectId } = args;
  const enabled = (options?.enabled ?? true) && Boolean(projectId);
  useProjectDetailRealtimeSubscription(projectId, { enabled });

  return useQuery<ProjectExecutionDefaults | null>({
    queryKey: projectDefaultExecutionOptionsQueryKey({
      projectId: projectId ?? "",
    }),
    queryFn: ({ signal }) =>
      fetchProjectDefaultExecutionOptions({
        projectId: requireProjectId(
          projectId,
          "useProjectDefaultExecutionOptions",
        ),
        signal,
      }),
    enabled,
    staleTime: 10_000,
    placeholderData: (previousData) => (projectId ? previousData : undefined),
  });
}
