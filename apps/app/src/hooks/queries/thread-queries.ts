import { useThreadDefaultExecutionOptions } from "./thread-default-execution-options-query";
import { useThreadQueuedMessages } from "./thread-panel-queries";
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { PendingInteraction, ThreadListEntry } from "@bb/domain";
import type {
  ThreadListResponse,
  ThreadPendingInteractionsResponse,
  ThreadResponse,
  ThreadSearchResponse,
  ThreadWithIncludesResponse,
  ThreadTimelineReadResponse,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import { useDebouncedValue } from "../useDebouncedValue";
import { routeTaggedPages, routeTaggedRead } from "./route-tags";
import {
  applyThreadTimelineDelta,
  isThreadTimelineDelta,
  publicApiRoutes,
} from "@bb/server-contract";
import type { ThreadListFilters } from "@bb/client-core";
import { sdk } from "@/lib/sdk";
import {
  useThreadDetailRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import {
  getCachedSidebarNavigationThreads,
  getCachedThreadListPlaceholder,
  findSidebarNavigationThreadPlaceholder,
} from "../cache-owners/query-cache";
import {
  useSidebarNavigationThreadSelection,
  type SidebarNavigationThreadSelection,
} from "./sidebar-navigation-query";
import {
  getCachedThreadLists,
  iterateThreadListCacheEntries,
} from "../cache-owners/thread-list-cache-data";
import type { ArchivedThreadsKindFilter } from "./query-keys";
import { resolveThreadPlaceholder } from "./query-placeholders";
import {
  requireEnabledQueryArg,
  requireThreadId,
  shouldRetryTransientReadQuery,
  TRANSIENT_READ_RETRY_DELAY_MS,
} from "./query-helpers";
import { REALTIME_OWNED_NO_FOCUS_QUERY_POLICY } from "./query-policies";
import {
  archivedThreadsListQueryKey,
  disabledThreadListQueryKey,
  threadDetailBootstrapQueryKey,
  threadListQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadSearchQueryKey,
  threadTimelineQueryKey,
  threadsQueryKey,
} from "./query-keys";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";
import { ingestThreadDetailBootstrap } from "../cache-owners/thread-detail-cache-owner";
import { clearThreadTimelineUnseenEvents } from "../cache-owners/thread-timeline-unseen-events";
import {
  isCachedThreadTimelinePushEnabled,
  resolveThreadTimelineSegmentLimit,
  syncThreadTimelineSubscriptionTag,
} from "../cache-owners/thread-timeline-push-owner";
import { markStreamTrace } from "@/lib/stream-trace";
import { THREAD_OPEN_CACHE_GC_MS } from "../cache-owners/thread-open-cache-owner";

export interface QueryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
}

export const THREAD_LIST_STALE_TIME_MS = 10_000;
const THREAD_SEARCH_STALE_TIME_MS = 10_000;
const THREAD_DETAIL_STALE_TIME_MS = 5_000;
const THREAD_MENTION_CANDIDATE_LIMIT = 200;
const THREAD_SEARCH_DEBOUNCE_MS = 150;
export const THREAD_SEARCH_LIMIT_PER_GROUP = 20;
const THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS = 2;

interface ThreadDetailBootstrapQueryOptions extends QueryOptions {
  timelinePrefetch?: boolean;
}

export function didThreadDetailBootstrapRefreshAfterMount(query: {
  dataUpdatedAt: number;
  isFetchedAfterMount: boolean;
  isSuccess: boolean;
}): boolean {
  return (
    query.isSuccess &&
    (query.isFetchedAfterMount ||
      (query.dataUpdatedAt > 0 &&
        Date.now() - query.dataUpdatedAt <= THREAD_DETAIL_STALE_TIME_MS))
  );
}

type ThreadPendingInteractionsQueryOptions = QueryOptions;

interface UseThreadsFilters extends Omit<
  ThreadListFilters,
  "archived" | "projectId"
> {
  archived: boolean;
  projectId?: string;
}

export interface ProjectThreadSubsetFilters {
  hasParent?: ThreadListFilters["hasParent"];
  parentThreadId?: string;
}

interface UseProjectThreadSubsetArgs {
  enabled?: boolean;
  filters: ProjectThreadSubsetFilters;
  projectId: string | undefined;
}

interface UseProjectThreadSubsetResult {
  data: ThreadListResponse | undefined;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  retry: () => void;
}

interface UseThreadMentionCandidatesResult {
  data: ThreadListResponse | undefined;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
}

interface UseThreadSearchArgs {
  active: boolean;
  limitPerGroup?: number;
  query: string;
}

export interface UseThreadSearchResult {
  data: ThreadSearchResponse | undefined;
  debouncedQuery: string;
  hasSearchableQuery: boolean;
  isDebouncing: boolean;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
}

interface BuildThreadSubsetListFiltersArgs {
  filters: ProjectThreadSubsetFilters;
  projectId: string | undefined;
}

interface UseThreadMentionCandidatesArgs {
  enabled?: boolean;
}

type ThreadListItem = ThreadListResponse[number];

interface GetThreadMentionCandidatePlaceholderArgs {
  limit: number;
  queryClient: QueryClient;
}

const THREAD_MENTION_CANDIDATE_FILTERS = {
  archived: false,
  limit: THREAD_MENTION_CANDIDATE_LIMIT,
} satisfies UseThreadsFilters;

function buildThreadSubsetListFilters({
  filters,
  projectId,
}: BuildThreadSubsetListFiltersArgs): UseThreadsFilters {
  const listFilters: UseThreadsFilters = {
    archived: false,
  };

  if (projectId !== undefined) {
    listFilters.projectId = projectId;
  }
  if (filters.parentThreadId !== undefined) {
    listFilters.parentThreadId = filters.parentThreadId;
  }
  if (filters.hasParent !== undefined) {
    listFilters.hasParent = filters.hasParent;
  }

  return listFilters;
}

function threadMatchesProjectThreadSubset(
  thread: ThreadListItem,
  filters: ProjectThreadSubsetFilters,
): boolean {
  if (
    filters.parentThreadId !== undefined &&
    thread.parentThreadId !== filters.parentThreadId
  ) {
    return false;
  }
  if (
    filters.hasParent !== undefined &&
    (thread.parentThreadId !== null) !== filters.hasParent
  ) {
    return false;
  }
  if (thread.visibility === "hidden") {
    return false;
  }
  return true;
}

function filterProjectThreadSubset(
  threads: ThreadListResponse,
  filters: ProjectThreadSubsetFilters,
): ThreadListResponse {
  return threads.filter((thread) =>
    threadMatchesProjectThreadSubset(thread, filters),
  );
}

function addThreadMentionCandidate(
  candidatesById: Map<string, ThreadListItem>,
  thread: ThreadListItem,
): void {
  if (thread.archivedAt !== null || thread.deletedAt !== null) {
    return;
  }
  if (thread.visibility === "hidden") {
    return;
  }
  if (!candidatesById.has(thread.id)) {
    candidatesById.set(thread.id, thread);
  }
}

const EMPTY_THREAD_LIST: ThreadListResponse = [];

export function selectThreadMentionCandidates(
  threads: ThreadListEntry[],
): ThreadListResponse {
  const candidatesById = new Map<string, ThreadListItem>();
  for (const thread of threads) {
    addThreadMentionCandidate(candidatesById, thread);
  }
  return Array.from(candidatesById.values());
}

function getThreadMentionCandidatePlaceholder({
  limit,
  queryClient,
}: GetThreadMentionCandidatePlaceholderArgs): ThreadListResponse | undefined {
  const candidatesById = new Map<string, ThreadListItem>();
  for (const thread of getCachedSidebarNavigationThreads(queryClient)) {
    addThreadMentionCandidate(candidatesById, thread);
  }
  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      addThreadMentionCandidate(candidatesById, thread);
    }
  }

  const candidates = Array.from(candidatesById.values()).slice(0, limit);
  return candidates.length > 0 ? candidates : undefined;
}

function countNonWhitespaceChars(value: string): number {
  return value.replace(/\s/g, "").length;
}

export function hasThreadSearchableQuery(value: string): boolean {
  return (
    countNonWhitespaceChars(value) >= THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS
  );
}

export interface UseArchivedThreadsFilters {
  projectId?: string;
  kind?: ArchivedThreadsKindFilter;
}

export function threadListRead(
  queryClient: QueryClient,
  queryKey: QueryKey,
  read: (signal: AbortSignal) => Promise<ThreadListResponse>,
) {
  return routeTaggedRead(
    queryClient,
    queryKey,
    publicApiRoutes.threads.list,
    { params: {}, input: {} },
    read,
  );
}

export function archivedThreadsQueryOptions(
  queryClient: QueryClient,
  filters: UseArchivedThreadsFilters,
  options?: QueryOptions,
) {
  const { projectId, kind = "all" } = filters;
  const hasParent = kind === "all" ? undefined : kind === "child";
  const queryKey = archivedThreadsListQueryKey({
    ...(projectId ? { projectId } : {}),
    ...(kind !== "all" ? { kind } : {}),
  });
  return infiniteQueryOptions<
    ThreadListResponse,
    Error,
    { pageParams: number[]; pages: ThreadListResponse[] },
    ReturnType<typeof archivedThreadsListQueryKey>,
    number
  >({
    queryKey,
    ...routeTaggedPages(
      queryClient,
      queryKey,
      publicApiRoutes.threads.list,
      { params: {}, input: {} },
      (pageParam: number, signal) =>
        sdk.threads.list({
          ...(projectId ? { projectId } : {}),
          ...(hasParent !== undefined ? { hasParent } : {}),
          archived: true,
          limit: ARCHIVED_THREADS_PAGE_SIZE,
          offset: pageParam,
          signal,
        }),
    ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < ARCHIVED_THREADS_PAGE_SIZE) {
        return undefined;
      }
      return allPages.reduce((sum, page) => sum + page.length, 0);
    },
    enabled: options?.enabled ?? true,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}

export function useArchivedThreads(
  filters: UseArchivedThreadsFilters,
  options?: QueryOptions,
) {
  const queryClient = useQueryClient();
  useThreadListRealtimeSubscription({ enabled: options?.enabled ?? true });
  return useInfiniteQuery(
    archivedThreadsQueryOptions(queryClient, filters, options),
  );
}

export function useThreads(filters: UseThreadsFilters, options?: QueryOptions) {
  const queryClient = useQueryClient();
  const { projectId, ...rest } = filters;
  const enabled = (options?.enabled ?? true) && Boolean(projectId);
  useThreadListRealtimeSubscription({ enabled });
  const queryKey =
    enabled && projectId
      ? threadListQueryKey({ ...rest, projectId })
      : disabledThreadListQueryKey(projectId ? { ...rest, projectId } : rest);

  return useQuery<ThreadListResponse>({
    queryKey,
    ...threadListRead(queryClient, queryKey, (signal) =>
      sdk.threads.list({
        ...rest,
        projectId: requireThreadId(projectId ?? "", "useThreads"),
        signal,
      }),
    ),
    enabled,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}

interface MachineThreadPreview {
  threads: ThreadListResponse;
  total: number;
}

export function useMachineThreadPreview({
  hostId,
  limit,
}: {
  hostId: string | null;
  limit: number;
}) {
  const enabled = hostId !== null;
  useThreadListRealtimeSubscription({ enabled });
  return useQuery<MachineThreadPreview>({
    queryKey:
      hostId === null
        ? disabledThreadListQueryKey({ archived: false, limit })
        : threadListQueryKey({ archived: false, hostId, limit }),
    queryFn: async ({ signal }) => {
      const id = requireEnabledQueryArg({
        value: hostId,
        hookName: "useMachineThreadPreview",
        argName: "host id",
      });
      const [threads, count] = await Promise.all([
        sdk.threads.list({ archived: false, hostId: id, limit, signal }),
        sdk.threads.count({ hostId: id, signal }),
      ]);
      return { threads, total: count.total };
    },
    enabled,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}

interface UseChildThreadsArgs {
  enabled: boolean;
  parentThreadId: string | undefined;
}

interface UseChildThreadsResult {
  data: ThreadListResponse | undefined;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
}

export function selectChildThreads(
  threads: ThreadListEntry[],
  parentThreadId: string | undefined,
): ThreadListResponse {
  return parentThreadId === undefined
    ? EMPTY_THREAD_LIST
    : filterProjectThreadSubset(threads, { parentThreadId });
}

export function shouldFetchSidebarThreadListFallback({
  enabled,
  sidebar,
}: {
  enabled: boolean;
  sidebar: SidebarNavigationThreadSelection<ThreadListResponse>;
}): boolean {
  return enabled && sidebar.data === undefined && !sidebar.isBootstrapPending;
}

export function resolveSidebarDerivedThreadList({
  enabled,
  sidebar,
  fallback,
}: {
  enabled: boolean;
  sidebar: SidebarNavigationThreadSelection<ThreadListResponse>;
  fallback: UseChildThreadsResult;
}): UseChildThreadsResult {
  const derived = enabled ? sidebar.data : undefined;
  if (derived !== undefined) {
    return {
      data: derived,
      isError: false,
      isFetching: false,
      isLoading: false,
    };
  }
  const waitingForBootstrap = enabled && sidebar.isBootstrapPending;
  return {
    data: fallback.data,
    isError: fallback.isError,
    isFetching: fallback.isFetching || waitingForBootstrap,
    isLoading: fallback.isLoading || waitingForBootstrap,
  };
}

export function childThreadsFallbackQueryOptions({
  parentThreadId,
  queryClient,
  shouldFetch,
}: {
  parentThreadId: string | undefined;
  queryClient: QueryClient;
  shouldFetch: boolean;
}) {
  const queryKey =
    shouldFetch && parentThreadId
      ? threadListQueryKey({ archived: false, parentThreadId })
      : disabledThreadListQueryKey({ archived: false });
  return queryOptions<ThreadListResponse>({
    queryKey,
    ...threadListRead(queryClient, queryKey, (signal) =>
      sdk.threads.list({
        archived: false,
        parentThreadId: requireThreadId(
          parentThreadId ?? "",
          "useChildThreads",
        ),
        signal,
      }),
    ),
    enabled: shouldFetch,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}

export function useChildThreads({
  enabled: enabledOption,
  parentThreadId,
}: UseChildThreadsArgs): UseChildThreadsResult {
  const queryClient = useQueryClient();
  const enabled = enabledOption && Boolean(parentThreadId);
  useThreadListRealtimeSubscription({ enabled });
  const selectChildren = useCallback(
    (threads: ThreadListEntry[]) => selectChildThreads(threads, parentThreadId),
    [parentThreadId],
  );
  const sidebar = useSidebarNavigationThreadSelection(selectChildren);
  const fallbackQuery = useQuery(
    childThreadsFallbackQueryOptions({
      parentThreadId,
      queryClient,
      shouldFetch: shouldFetchSidebarThreadListFallback({ enabled, sidebar }),
    }),
  );
  return resolveSidebarDerivedThreadList({
    enabled,
    sidebar,
    fallback: fallbackQuery,
  });
}

export function useProjectThreadSubset({
  enabled: enabledOption,
  filters,
  projectId,
}: UseProjectThreadSubsetArgs): UseProjectThreadSubsetResult {
  const queryClient = useQueryClient();
  const enabled = (enabledOption ?? true) && Boolean(projectId);
  useThreadListRealtimeSubscription({ enabled });
  const { hasParent, parentThreadId } = filters;
  const activeProjectThreadListQueryKey =
    enabled && projectId
      ? threadListQueryKey({ archived: false, projectId })
      : disabledThreadListQueryKey(
          projectId ? { archived: false, projectId } : { archived: false },
        );
  const activeProjectThreadListIsCached =
    enabled &&
    projectId !== undefined &&
    queryClient.getQueryData<ThreadListResponse>(
      threadListQueryKey({ archived: false, projectId }),
    ) !== undefined;
  const activeProjectThreadsQuery = useQuery<ThreadListResponse>({
    queryKey: activeProjectThreadListQueryKey,
    ...threadListRead(queryClient, activeProjectThreadListQueryKey, (signal) =>
      sdk.threads.list({
        archived: false,
        projectId: requireThreadId(projectId ?? "", "useProjectThreadSubset"),
        signal,
      }),
    ),
    enabled: enabled && activeProjectThreadListIsCached,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
  const hasActiveProjectThreadList =
    activeProjectThreadsQuery.data !== undefined;
  const targetedThreadsQuery = useThreads(
    buildThreadSubsetListFilters({ filters, projectId }),
    {
      enabled: enabled && !hasActiveProjectThreadList,
    },
  );
  const derivedThreads = useMemo(
    () =>
      activeProjectThreadsQuery.data
        ? filterProjectThreadSubset(activeProjectThreadsQuery.data, {
            hasParent,
            parentThreadId,
          })
        : undefined,
    [activeProjectThreadsQuery.data, hasParent, parentThreadId],
  );
  const refetchActiveProjectThreads = activeProjectThreadsQuery.refetch;
  const refetchTargetedThreads = targetedThreadsQuery.refetch;
  const retry = useCallback(() => {
    void (hasActiveProjectThreadList
      ? refetchActiveProjectThreads()
      : refetchTargetedThreads());
  }, [
    hasActiveProjectThreadList,
    refetchActiveProjectThreads,
    refetchTargetedThreads,
  ]);

  return {
    data: derivedThreads ?? targetedThreadsQuery.data,
    isError: hasActiveProjectThreadList
      ? activeProjectThreadsQuery.isError
      : targetedThreadsQuery.isError,
    isFetching: hasActiveProjectThreadList
      ? activeProjectThreadsQuery.isFetching
      : targetedThreadsQuery.isFetching,
    isLoading: hasActiveProjectThreadList
      ? activeProjectThreadsQuery.isLoading
      : targetedThreadsQuery.isLoading,
    retry,
  };
}

export function threadMentionCandidatesFallbackQueryOptions({
  queryClient,
  shouldFetch,
}: {
  queryClient: QueryClient;
  shouldFetch: boolean;
}) {
  const queryKey = shouldFetch
    ? threadListQueryKey(THREAD_MENTION_CANDIDATE_FILTERS)
    : disabledThreadListQueryKey(THREAD_MENTION_CANDIDATE_FILTERS);
  return queryOptions<ThreadListResponse>({
    queryKey,
    ...threadListRead(queryClient, queryKey, (signal) =>
      sdk.threads.list({ ...THREAD_MENTION_CANDIDATE_FILTERS, signal }),
    ),
    enabled: shouldFetch,
    placeholderData: (previousData) =>
      previousData ??
      getThreadMentionCandidatePlaceholder({
        limit: THREAD_MENTION_CANDIDATE_LIMIT,
        queryClient,
      }),
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}

export function useThreadMentionCandidates({
  enabled: enabledOption,
}: UseThreadMentionCandidatesArgs): UseThreadMentionCandidatesResult {
  const queryClient = useQueryClient();
  const enabled = enabledOption ?? true;
  useThreadListRealtimeSubscription({ enabled });
  const sidebar = useSidebarNavigationThreadSelection(
    selectThreadMentionCandidates,
  );
  const threadsQuery = useQuery(
    threadMentionCandidatesFallbackQueryOptions({
      queryClient,
      shouldFetch: shouldFetchSidebarThreadListFallback({ enabled, sidebar }),
    }),
  );
  return resolveSidebarDerivedThreadList({
    enabled,
    sidebar,
    fallback: threadsQuery,
  });
}

export function useThreadSearch({
  active,
  limitPerGroup = THREAD_SEARCH_LIMIT_PER_GROUP,
  query,
}: UseThreadSearchArgs): UseThreadSearchResult {
  const debouncedRawQuery = useDebouncedValue(query, THREAD_SEARCH_DEBOUNCE_MS);
  const trimmedQuery = query.trim();
  const debouncedQuery = debouncedRawQuery.trim();
  const liveQueryIsSearchable = hasThreadSearchableQuery(trimmedQuery);
  const hasSearchableQuery = hasThreadSearchableQuery(debouncedQuery);
  const isDebouncing =
    active && liveQueryIsSearchable && trimmedQuery !== debouncedQuery;
  const enabled = active && liveQueryIsSearchable && hasSearchableQuery;
  const threadSearchQuery = useQuery<ThreadSearchResponse>({
    queryKey: threadSearchQueryKey({
      limitPerGroup,
      query: debouncedQuery,
    }),
    queryFn: ({ signal }) =>
      sdk.threads.search({
        limitPerGroup: String(limitPerGroup),
        query: debouncedQuery,
        signal,
      }),
    enabled,
    staleTime: THREAD_SEARCH_STALE_TIME_MS,
  });

  return {
    data: threadSearchQuery.data,
    debouncedQuery,
    hasSearchableQuery,
    isDebouncing,
    isError: threadSearchQuery.isError,
    isFetching: threadSearchQuery.isFetching,
    isLoading: threadSearchQuery.isLoading,
  };
}

export function threadQueryOptions(
  queryClient: QueryClient,
  id: string,
  options?: QueryOptions,
) {
  const queryKey = threadQueryKey(id);
  return queryOptions<ThreadResponse>({
    queryKey,
    ...routeTaggedRead(
      queryClient,
      queryKey,
      publicApiRoutes.threads.get,
      { params: { id }, input: {} },
      (signal) =>
        sdk.threads.get({
          threadId: requireThreadId(id, "useThread"),
          signal,
        }),
    ),
    enabled: (options?.enabled ?? true) && Boolean(id),
    staleTime: THREAD_DETAIL_STALE_TIME_MS,
    refetchOnMount: options?.refetchOnMount ?? true,
    retry: shouldRetryTransientReadQuery,
    retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
    placeholderData: (previousData, previousQuery) =>
      resolveThreadPlaceholder(previousData, previousQuery?.queryKey, id) ??
      liftThreadListPlaceholder(
        getCachedThreadListPlaceholder(queryClient, id) ??
          findSidebarNavigationThreadPlaceholder(queryClient, id),
      ),
  });
}

export function useThread(id: string, options?: QueryOptions) {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });
  return useQuery(threadQueryOptions(queryClient, id, options));
}

function liftThreadListPlaceholder(
  thread: ThreadListEntry | undefined,
): ThreadResponse | undefined {
  if (thread === undefined) {
    return undefined;
  }
  return {
    ...thread,
    activeBackgroundAgentCount: thread.activity.activeBackgroundAgentCount,
    canRestoreEnvironment: false,
    canEditMessages: false,
    canSpawnChild: false,
    queuedMessageCount: 0,
  };
}

export function threadDetailBootstrapQueryOptions(
  queryClient: QueryClient,
  id: string,
  options?: ThreadDetailBootstrapQueryOptions,
) {
  return queryOptions<ThreadWithIncludesResponse>({
    queryKey: threadDetailBootstrapQueryKey(id),
    queryFn: async ({ signal }) => {
      const threadId = requireThreadId(id, "useThreadDetailBootstrap");
      const timelinePrefetch = options?.timelinePrefetch ?? false;

      if (timelinePrefetch) {
        void queryClient.prefetchQuery({
          queryKey: threadTimelineQueryKey(threadId),
          queryFn: ({ signal: timelineSignal }) =>
            fetchThreadTimeline({
              queryClient,
              signal: timelineSignal,
              threadId,
            }),
        });
      }

      const thread = await sdk.threads.get({
        include: "environment,host",
        threadId,
        signal,
      });
      ingestThreadDetailBootstrap({
        queryClient,
        thread,
      });
      return thread;
    },
    enabled: (options?.enabled ?? true) && Boolean(id),
    staleTime: Infinity,
    gcTime: THREAD_OPEN_CACHE_GC_MS,
    retry: shouldRetryTransientReadQuery,
    retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
  });
}

export function useThreadDetailBootstrap(
  id: string,
  options?: ThreadDetailBootstrapQueryOptions,
) {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });
  useThreadDefaultExecutionOptions(id, { enabled });
  useThreadQueuedMessages(id, { enabled });
  return useQuery(threadDetailBootstrapQueryOptions(queryClient, id, options));
}

export function threadPendingInteractionsQueryOptions(
  id: string,
  options?: ThreadPendingInteractionsQueryOptions,
) {
  return queryOptions<ThreadPendingInteractionsResponse>({
    queryKey: threadPendingInteractionsQueryKey(id),
    queryFn: ({ signal }) =>
      sdk.threads.interactions.list({
        threadId: requireThreadId(id, "useThreadPendingInteractions"),
        signal,
      }),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount:
      options?.refetchOnMount ??
      ((query) => (query.getObserversCount() === 1 ? "always" : true)),
    ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
    ...(options?.staleTime === undefined
      ? {}
      : { staleTime: options.staleTime }),
  });
}

export function useThreadPendingInteractions(
  id: string,
  options?: ThreadPendingInteractionsQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });
  return useQuery(threadPendingInteractionsQueryOptions(id, options));
}

async function mergeThreadTimelineDelta(
  previous: ThreadTimelineResponse | undefined,
  response: ThreadTimelineReadResponse,
  fetchFull: () => Promise<ThreadTimelineResponse>,
): Promise<ThreadTimelineResponse> {
  if (!isThreadTimelineDelta(response)) {
    return response;
  }
  const merged =
    previous === undefined
      ? null
      : applyThreadTimelineDelta(previous, response);
  return merged ?? fetchFull();
}

interface FetchThreadTimelineArgs {
  queryClient: QueryClient;
  signal: AbortSignal;
  threadId: string;
}

export async function fetchThreadTimeline({
  queryClient,
  signal,
  threadId,
}: FetchThreadTimelineArgs): Promise<ThreadTimelineResponse> {
  const queryKey = threadTimelineQueryKey(threadId);
  const previous = queryClient.getQueryData<ThreadTimelineResponse>(queryKey);
  const segmentLimit = resolveThreadTimelineSegmentLimit();
  const pageArgs = {
    deferContent: "true" as const,
    ...(segmentLimit === undefined
      ? {}
      : { segmentLimit: String(segmentLimit) }),
  };
  const response = await sdk.threads.timeline({
    threadId,
    signal,
    ...pageArgs,
    ...(previous === undefined ? {} : { afterTag: previous.tag }),
  });
  const merged = await mergeThreadTimelineDelta(previous, response, () =>
    sdk.threads.timeline({ threadId, signal, ...pageArgs }),
  );
  const pushed = isCachedThreadTimelinePushEnabled(queryClient)
    ? queryClient.getQueryData<ThreadTimelineResponse>(queryKey)
    : undefined;
  const timeline =
    pushed !== undefined && pushed.maxSeq > merged.maxSeq ? pushed : merged;
  clearThreadTimelineUnseenEvents(queryClient, threadId, timeline.maxSeq);
  syncThreadTimelineSubscriptionTag(queryClient, threadId, timeline.tag);
  markStreamTrace("bb:timeline-applied", {
    threadId,
    maxSeq: timeline.maxSeq,
    source: isThreadTimelineDelta(response) ? "fetch-delta" : "fetch",
  });
  return timeline;
}

const EMPTY_PENDING_INTERACTIONS: readonly PendingInteraction[] = [];

export function orderPendingInteractions(
  interactions: readonly PendingInteraction[] | undefined,
): readonly PendingInteraction[] {
  if (!interactions || interactions.length === 0) {
    return EMPTY_PENDING_INTERACTIONS;
  }
  return [...interactions].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}
