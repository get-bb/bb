import type { ThreadListEntry } from "@bb/domain";
import type { ThreadSearchResponse } from "@bb/server-contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { threadSearchQueryKey } from "@/lib/query/query-keys";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { sidebarThreadsFromBootstrap } from "../threads/thread-list-cache";
import { useSidebarBootstrap } from "./sidebar-bootstrap";
import {
  hasThreadSearchableQuery,
  selectRecentThreads,
  THREAD_SEARCH_DEBOUNCE_MS,
  THREAD_SEARCH_LIMIT_PER_GROUP,
} from "./thread-search-query";

const THREAD_SEARCH_STALE_TIME_MS = 10_000;

export interface UseThreadSearchArgs {
  /** Only search while the search UI is open. */
  active?: boolean;
  limitPerGroup?: number;
}

export interface UseThreadSearchResult {
  data: ThreadSearchResponse | undefined;
  /** The trimmed query the current `data` answers. */
  debouncedQuery: string;
  hasSearchableQuery: boolean;
  isDebouncing: boolean;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
}

/**
 * `GET /threads/search` for a live query: debounced 150 ms and gated on two
 * non-whitespace characters (mirrors the web `useThreadSearch`). Results are
 * grouped `active` / `archived` with highlight ranges.
 */
export function useThreadSearch(
  query: string,
  {
    active = true,
    limitPerGroup = THREAD_SEARCH_LIMIT_PER_GROUP,
  }: UseThreadSearchArgs = {},
): UseThreadSearchResult {
  const { sdk } = useProfileClient();
  const debouncedRawQuery = useDebouncedValue(query, THREAD_SEARCH_DEBOUNCE_MS);
  const trimmedQuery = query.trim();
  const debouncedQuery = debouncedRawQuery.trim();
  const liveQueryIsSearchable = hasThreadSearchableQuery(trimmedQuery);
  const hasSearchableQuery = hasThreadSearchableQuery(debouncedQuery);
  const isDebouncing =
    active && liveQueryIsSearchable && trimmedQuery !== debouncedQuery;
  const enabled = active && liveQueryIsSearchable && hasSearchableQuery;
  const search = useQuery<ThreadSearchResponse>({
    queryKey: threadSearchQueryKey({ limitPerGroup, query: debouncedQuery }),
    queryFn: ({ signal }) =>
      sdk.threads.search({
        limitPerGroup: String(limitPerGroup),
        query: debouncedQuery,
        signal,
      }),
    enabled,
    staleTime: THREAD_SEARCH_STALE_TIME_MS,
    // Keep the previous results on screen while the next query loads so the
    // list does not blank between keystrokes.
    placeholderData: keepPreviousData,
  });
  return {
    data: search.data,
    debouncedQuery,
    hasSearchableQuery,
    isDebouncing,
    isError: search.isError,
    isFetching: search.isFetching,
    isLoading: search.isLoading,
  };
}

const RECENT_THREADS_DEFAULT_LIMIT = 20;

/** Recently active threads from the sidebar bootstrap (no extra request). */
export function useRecentThreads(limit = RECENT_THREADS_DEFAULT_LIMIT): {
  threads: ThreadListEntry[];
  isLoading: boolean;
} {
  const bootstrap = useSidebarBootstrap();
  const threads = useMemo(
    () =>
      bootstrap.data
        ? selectRecentThreads(
            sidebarThreadsFromBootstrap(bootstrap.data),
            limit,
          )
        : [],
    [bootstrap.data, limit],
  );
  return { threads, isLoading: bootstrap.isLoading };
}
