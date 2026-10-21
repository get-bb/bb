import {
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import {
  publicApiRoutes,
  type SidebarBootstrapResponse,
} from "@bb/server-contract";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";
import {
  useEnvironmentListRealtimeSubscription,
  useHostListRealtimeSubscription,
  useProjectListRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import type { QueryOptions } from "./query-helpers";
import { sidebarNavigationQueryKey } from "./query-keys";
import { REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY } from "./query-policies";
import { routeLiveRead } from "./route-changes";
import {
  readCachedSidebarBootstrap,
  writeCachedSidebarBootstrap,
} from "@/lib/sidebar-bootstrap-cache";

function fetchSidebarNavigation(
  signal?: AbortSignal,
): Promise<SidebarBootstrapResponse> {
  return request<SidebarBootstrapResponse>(
    apiClient["sidebar-bootstrap"].$get(undefined, requestOptions(signal)),
  );
}

function sidebarNavigationReadOptions(
  client: QueryClient,
  read: (signal: AbortSignal) => Promise<SidebarBootstrapResponse>,
) {
  const queryKey = sidebarNavigationQueryKey();
  return {
    queryKey,
    ...routeLiveRead(
      client,
      queryKey,
      publicApiRoutes.projects.sidebarBootstrap,
      { params: {}, input: undefined },
      read,
    ),
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
  };
}

export function useSidebarNavigation(options?: QueryOptions) {
  const client = useQueryClient();
  const enabled = options?.enabled ?? true;
  useEnvironmentListRealtimeSubscription({ enabled });
  useHostListRealtimeSubscription({ enabled });
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<SidebarBootstrapResponse>({
    ...sidebarNavigationReadOptions(client, async (signal) => {
      const response = await fetchSidebarNavigation(signal);
      writeCachedSidebarBootstrap(response);
      return response;
    }),
    enabled,
    placeholderData: () => readCachedSidebarBootstrap() ?? undefined,
  });
}

export function useProjectDisplayName(
  projectId: string | undefined,
): string | undefined {
  const client = useQueryClient();
  const { data } = useQuery<SidebarBootstrapResponse>({
    ...sidebarNavigationReadOptions(client, fetchSidebarNavigation),
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

export interface SidebarNavigationThreadSelection<T> {
  data: T | undefined;
  isBootstrapPending: boolean;
}

export function sidebarNavigationThreadSelectionQueryOptions<T>(
  client: QueryClient,
  selectFromNavigation: (navigation: SidebarBootstrapResponse) => T,
) {
  return queryOptions<SidebarBootstrapResponse, Error, T>({
    ...sidebarNavigationReadOptions(client, fetchSidebarNavigation),
    enabled: false,
    select: selectFromNavigation,
  });
}

export function toSidebarNavigationThreadSelection<T>(result: {
  data: T | undefined;
  isFetching: boolean;
}): SidebarNavigationThreadSelection<T> {
  const data = result.data;
  return {
    data,
    isBootstrapPending: data === undefined && result.isFetching,
  };
}

export function useSidebarNavigationThreadSelection<T>(
  select: (threads: ThreadListEntry[]) => T,
): SidebarNavigationThreadSelection<T> {
  const client = useQueryClient();
  const selectFromNavigation = useCallback(
    (navigation: SidebarBootstrapResponse) =>
      select(listSidebarNavigationThreads(navigation)),
    [select],
  );
  return toSidebarNavigationThreadSelection(
    useQuery(
      sidebarNavigationThreadSelectionQueryOptions(
        client,
        selectFromNavigation,
      ),
    ),
  );
}
