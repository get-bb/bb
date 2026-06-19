import { useQuery } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";
import {
  useEnvironmentListRealtimeSubscription,
  useHostListRealtimeSubscription,
  useProjectListRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";

export const SIDEBAR_NAVIGATION_QUERY_KEY = "sidebarNavigation";

export type SidebarNavigationQueryKey = readonly [
  typeof SIDEBAR_NAVIGATION_QUERY_KEY,
];

interface QueryOptions {
  enabled?: boolean;
}

export function sidebarNavigationQueryKey(): SidebarNavigationQueryKey {
  return [SIDEBAR_NAVIGATION_QUERY_KEY];
}

export function fetchSidebarNavigation(
  signal?: AbortSignal,
): Promise<SidebarBootstrapResponse> {
  return request<SidebarBootstrapResponse>(
    apiClient["sidebar-bootstrap"].$get(undefined, requestOptions(signal)),
  );
}

export function useSidebarNavigation(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useEnvironmentListRealtimeSubscription({ enabled });
  useHostListRealtimeSubscription({ enabled });
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(signal),
    enabled,
    staleTime: Infinity,
  });
}

/**
 * Read the active project's display name from the shared sidebar-navigation
 * cache. The sidebar owns the realtime subscriptions and initial load; this only
 * reads the cached projects (no extra subscriptions) so surfaces like the
 * follow-up composer footer can label the current project. Returns undefined
 * until the cache is populated or when the project is unknown.
 */
export function useProjectDisplayName(
  projectId: string | undefined,
): string | undefined {
  const { data } = useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(signal),
    staleTime: Infinity,
    // Nothing to resolve without a project id (e.g. personal threads), so don't
    // trigger the bootstrap fetch from this read-only selector.
    enabled: Boolean(projectId),
  });
  if (!data || !projectId) {
    return undefined;
  }
  if (projectId === PERSONAL_PROJECT_ID) {
    return data.personalProject.name;
  }
  return data.projects.find((project) => project.id === projectId)?.name;
}
