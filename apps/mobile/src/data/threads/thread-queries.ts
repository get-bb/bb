import type { ThreadListEntry } from "@bb/domain";
import type { ThreadListResponse, ThreadResponse } from "@bb/server-contract";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  shouldRetryTransientReadQuery,
  TRANSIENT_READ_RETRY_DELAY_MS,
} from "@/lib/query/query-client";
import {
  archivedThreadsListQueryKey,
  threadListQueryKey,
  threadQueryKey,
  type ArchivedThreadsKindFilter,
  type ThreadListQueryFilters,
} from "@/lib/query/query-keys";
import { requireEnabledQueryArg } from "../shared/query-helpers";
import {
  useThreadDetailRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "../shared/use-realtime-subscription";
import { findCachedThreadListEntry } from "./thread-list-cache";

interface QueryOptions {
  enabled?: boolean;
}

export const THREAD_LIST_STALE_TIME_MS = 10_000;
const THREAD_DETAIL_STALE_TIME_MS = 5_000;
const ARCHIVED_THREADS_PAGE_SIZE = 50;

/**
 * A thread primed from a list cache has no spawn-policy flag (list rows omit
 * it). Hide the spawn affordance on the placeholder; the real single-thread
 * response resolves moments later.
 */
function liftThreadListPlaceholder(
  entry: ThreadListEntry | undefined,
): ThreadResponse | undefined {
  if (entry === undefined) return undefined;
  return {
    ...entry,
    activeBackgroundAgentCount: entry.activity.activeBackgroundAgentCount,
    canSpawnChild: false,
  };
}

/** `GET /threads/:id`, kept live through the `thread-detail` subscription. */
export function useThread(id: string, options?: QueryOptions) {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadResponse>({
    queryKey: threadQueryKey(id),
    queryFn: ({ signal }) =>
      sdk.threads.get({
        threadId: requireEnabledQueryArg({
          value: id,
          hookName: "useThread",
          argName: "thread id",
        }),
        signal,
      }),
    enabled,
    staleTime: THREAD_DETAIL_STALE_TIME_MS,
    retry: shouldRetryTransientReadQuery,
    retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
    placeholderData: (previousData) =>
      previousData?.id === id
        ? previousData
        : liftThreadListPlaceholder(findCachedThreadListEntry(queryClient, id)),
  });
}

export type ThreadsListFilters = ThreadListQueryFilters;

/**
 * `GET /threads` with app-side filters. Callers must pick `archived`; the
 * server treats omission as "both", which no navigation surface wants.
 */
export function useThreadsList(
  filters: ThreadsListFilters,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = options?.enabled ?? true;
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<ThreadListResponse>({
    queryKey: threadListQueryKey(filters),
    queryFn: ({ signal }) => sdk.threads.list({ ...filters, signal }),
    enabled,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}

export interface UseArchivedThreadsFilters {
  projectId?: string;
  /** Restrict to root or child threads. */
  kind?: ArchivedThreadsKindFilter;
}

/** Paginated archived list (Settings → Archived); pages of 50. */
export function useArchivedThreads(
  filters: UseArchivedThreadsFilters = {},
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const { projectId, kind = "all" } = filters;
  const enabled = options?.enabled ?? true;
  const hasParent = kind === "all" ? undefined : kind === "child";
  useThreadListRealtimeSubscription({ enabled });

  return useInfiniteQuery<
    ThreadListResponse,
    Error,
    { pageParams: number[]; pages: ThreadListResponse[] },
    ReturnType<typeof archivedThreadsListQueryKey>,
    number
  >({
    queryKey: archivedThreadsListQueryKey({
      ...(projectId ? { projectId } : {}),
      ...(kind !== "all" ? { kind } : {}),
    }),
    queryFn: ({ pageParam, signal }) =>
      sdk.threads.list({
        ...(projectId ? { projectId } : {}),
        ...(hasParent !== undefined ? { hasParent } : {}),
        archived: true,
        limit: ARCHIVED_THREADS_PAGE_SIZE,
        offset: pageParam,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < ARCHIVED_THREADS_PAGE_SIZE
        ? undefined
        : allPages.reduce((sum, page) => sum + page.length, 0),
    enabled,
    staleTime: THREAD_LIST_STALE_TIME_MS,
    // Switching the project filter keeps the previous pages on screen until
    // the new first page arrives.
    placeholderData: keepPreviousData,
  });
}
