import { useQuery } from "@tanstack/react-query";
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
import { REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY } from "./query-policies";
import {
  readCachedSidebarBootstrap,
  writeCachedSidebarBootstrap,
} from "@/lib/sidebar-bootstrap-cache";

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
    queryFn: async ({ signal }) => {
      const response = await fetchSidebarNavigation(signal);
      // Bounded and written off the critical path; see the cache module.
      writeCachedSidebarBootstrap(response);
      return response;
    },
    enabled,
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    // A full load starts from an empty query cache, so the rail showed its
    // two-row loading skeleton on every visit until the bootstrap resolved.
    // Replay the last bootstrap this profile received instead (a bounded
    // copy: projects whole, thread lists capped); the live response replaces
    // it in place. Consumers treat the replay like any sidebar data
    // (navigation only), and a cold profile still shows the skeleton, so
    // first-run behavior is unchanged.
    placeholderData: () => readCachedSidebarBootstrap() ?? undefined,
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
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
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

export interface SidebarNavigationThreadSelection<T> {
  /** `select` applied to every thread row in the cache, or `undefined` while it holds nothing. */
  data: T | undefined;
  /**
   * `true` while the cache is empty but the app shell's bootstrap request is
   * in flight. Derived surfaces should wait for it rather than issue their own
   * targeted list request on a cold open (a deep link races the bootstrap).
   * Stays `false` when nothing is fetching the bootstrap or it already failed,
   * so surfaces mounted without the shell still get their network fallback.
   */
  isBootstrapPending: boolean;
}

/**
 * Live selection over every thread row in the sidebar-navigation cache. This
 * is a read-only observer: it never triggers the bootstrap fetch itself (the
 * app shell owns that and the realtime subscriptions). Thread-list surfaces
 * that used to issue their own `GET /threads` can derive from this instead and
 * keep a network fallback for the `undefined` case.
 *
 * The bootstrap payload changes on every sidebar patch (any thread's status,
 * title, or unread badge), so callers pass a memoized `select` and only
 * re-render when its structurally-shared result changes, not on every patch.
 */
export function useSidebarNavigationThreadSelection<T>(
  select: (threads: ThreadListEntry[]) => T,
): SidebarNavigationThreadSelection<T> {
  const selectFromNavigation = useCallback(
    (navigation: SidebarBootstrapResponse) =>
      select(listSidebarNavigationThreads(navigation)),
    [select],
  );
  const result = useQuery<SidebarBootstrapResponse, Error, T>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(signal),
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    enabled: false,
    select: selectFromNavigation,
  });
  const data = result.data;
  // Only read `isFetching` while there is nothing to derive from: react-query
  // tracks accessed fields, so a populated cache does not re-render callers on
  // every bootstrap refetch.
  return {
    data,
    isBootstrapPending: data === undefined && result.isFetching,
  };
}
