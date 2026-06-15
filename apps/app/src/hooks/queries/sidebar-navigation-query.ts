import { useQuery } from "@tanstack/react-query";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";

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
  return useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(signal),
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
  });
}
