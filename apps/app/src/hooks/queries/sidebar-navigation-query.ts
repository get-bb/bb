import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
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
import {
  readCachedSidebarBootstrap,
  writeCachedSidebarBootstrap,
} from "@/lib/sidebar-bootstrap-cache";

function sidebarNavigationQueryOptions() {
  return queryOptions({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: async ({ signal }) => {
      const response = await request<SidebarBootstrapResponse>(
        apiClient["sidebar-bootstrap"].$get(undefined, requestOptions(signal)),
      );
      writeCachedSidebarBootstrap(response);
      return response;
    },
    initialData: () => readCachedSidebarBootstrap() ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: (query) => (query.state.dataUpdatedAt === 0 ? 0 : Infinity),
  });
}

export function useSidebarNavigation(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useEnvironmentListRealtimeSubscription({ enabled });
  useHostListRealtimeSubscription({ enabled });
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery({
    ...sidebarNavigationQueryOptions(),
    enabled,
  });
}

export function useProjectDisplayName(
  projectId: string | undefined,
): string | undefined {
  const { data } = useQuery({
    ...sidebarNavigationQueryOptions(),
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

interface SidebarNavigationThreadSelection<T> {
  data: T | undefined;
  isBootstrapPending: boolean;
}

export function useSidebarNavigationThreadSelection<T>(
  select: (threads: ThreadListEntry[]) => T,
): SidebarNavigationThreadSelection<T> {
  const selectFromNavigation = useCallback(
    (navigation: SidebarBootstrapResponse) =>
      select(listSidebarNavigationThreads(navigation)),
    [select],
  );
  const result = useQuery({
    ...sidebarNavigationQueryOptions(),
    enabled: false,
    select: selectFromNavigation,
  });
  const data = result.data;
  return {
    data,
    isBootstrapPending: data === undefined && result.isFetching,
  };
}
