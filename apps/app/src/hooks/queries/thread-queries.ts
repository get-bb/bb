import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useDebounceValue } from "usehooks-ts";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { getMediaQuerySnapshot } from "@bb/shared-ui/hooks/use-media-query";
import type { PendingInteraction, ThreadListEntry } from "@bb/domain";
import type {
  PromptHistoryResponse,
  ThreadQueuedMessageListResponse,
  ThreadListResponse,
  ThreadPendingInteractionsResponse,
  ThreadResponse,
  ThreadSearchResponse,
  ThreadWithIncludesResponse,
  ThreadConversationOutlineResponse,
  ThreadStorageFileListResponse,
  ThreadStoragePathListResponse,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import { applyTimelineDelta } from "@bb/server-contract";
import type { ThreadListFilters } from "@/lib/api-types";
import type { FilePreview } from "@/lib/file-preview";
import type { PathListOptions } from "@/lib/path-list-options";
import type { ThreadStorageFileListOptions } from "@/lib/thread-storage-files";
import * as api from "@/lib/api";
import { sdk } from "@/lib/sdk";
import {
  useThreadDetailRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import {
  getCachedSidebarNavigationThreads,
  getCachedThreadListPlaceholder,
} from "../cache-owners/query-cache";
import { useSidebarNavigationThreadSelection } from "./sidebar-navigation-query";
import {
  getCachedThreadLists,
  iterateThreadListCacheEntries,
} from "../cache-owners/thread-list-cache-data";
import type { ArchivedThreadsKindFilter } from "./query-keys";
import {
  resolveThreadPlaceholder,
  resolveThreadTimelinePlaceholder,
} from "./query-placeholders";
import {
  PROMPT_HISTORY_STALE_TIME_MS,
  requireEnabledQueryArg,
  shouldRetryTransientReadQuery,
  TRANSIENT_READ_RETRY_DELAY_MS,
} from "./query-helpers";
import {
  HEAVY_PAYLOAD_QUERY_POLICY,
  REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
  RESUME_REFETCH_QUERY_POLICY,
} from "./query-policies";
import {
  archivedThreadsListQueryKey,
  disabledThreadListQueryKey,
  threadDetailBootstrapQueryKey,
  threadQueuedMessagesQueryKey,
  threadListQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadSearchQueryKey,
  threadStorageFilesQueryKey,
  threadStoragePathsQueryKey,
  threadStorageFilePreviewQueryKey,
  threadHostFilePreviewQueryKey,
  threadConversationOutlineQueryKey,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
  threadsQueryKey,
  type ThreadTimelineTurnSummaryDetailsQueryIdentity,
} from "./query-keys";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";
import { ingestThreadDetailBootstrap } from "../cache-owners/thread-detail-cache-owner";

interface QueryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
}

const THREAD_LIST_STALE_TIME_MS = 10_000;
const THREAD_SEARCH_STALE_TIME_MS = 10_000;
const THREAD_DETAIL_STALE_TIME_MS = 5_000;
export const THREAD_MENTION_CANDIDATE_LIMIT = 200;
export const THREAD_SEARCH_DEBOUNCE_MS = 150;
export const THREAD_SEARCH_LIMIT_PER_GROUP = 20;
export const THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS = 2;

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

type ThreadTimelineQueryOptions = QueryOptions;

type ThreadTimelineTurnSummaryDetailsQueryOptions = QueryOptions;

type ThreadQueuedMessagesQueryOptions = QueryOptions;

type ThreadPromptHistoryQueryOptions = QueryOptions;

type ThreadPendingInteractionsQueryOptions = QueryOptions;

export interface UseThreadsFilters extends Omit<
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

export interface UseProjectThreadSubsetArgs {
  enabled?: boolean;
  filters: ProjectThreadSubsetFilters;
  projectId: string | undefined;
}

export interface UseProjectThreadSubsetResult {
  data: ThreadListResponse | undefined;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  retry: () => void;
}

export interface UseThreadMentionCandidatesResult {
  data: ThreadListResponse | undefined;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
}

export interface UseThreadSearchArgs {
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

export interface UseThreadMentionCandidatesArgs {
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

function requireThreadId(id: string, hookName: string): string {
  return requireEnabledQueryArg({ value: id, hookName, argName: "thread id" });
}

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
  // Hidden threads never enter subset caches: every subset consumer is a
  // navigation surface, matching the server's default list exclusion.
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

function buildThreadMentionCandidates(
  threads: readonly ThreadListItem[],
  { limit }: { limit: number },
): ThreadListResponse {
  const candidatesById = new Map<string, ThreadListItem>();
  for (const thread of threads) {
    addThreadMentionCandidate(candidatesById, thread);
  }
  return Array.from(candidatesById.values()).slice(0, limit);
}

const EMPTY_THREAD_LIST: ThreadListResponse = [];

function selectThreadMentionCandidates(
  threads: ThreadListEntry[],
): ThreadListResponse {
  return buildThreadMentionCandidates(threads, {
    limit: THREAD_MENTION_CANDIDATE_LIMIT,
  });
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
  /** Restrict to root or child threads. */
  kind?: ArchivedThreadsKindFilter;
}

export function useArchivedThreads(
  filters: UseArchivedThreadsFilters,
  options?: QueryOptions,
) {
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
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < ARCHIVED_THREADS_PAGE_SIZE) {
        return undefined;
      }
      return allPages.reduce((sum, page) => sum + page.length, 0);
    },
    enabled,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}

export function useThreads(filters: UseThreadsFilters, options?: QueryOptions) {
  const { projectId, ...rest } = filters;
  const enabled = (options?.enabled ?? true) && Boolean(projectId);
  useThreadListRealtimeSubscription({ enabled });
  const queryKey =
    enabled && projectId
      ? threadListQueryKey({ ...rest, projectId })
      : disabledThreadListQueryKey(projectId ? { ...rest, projectId } : rest);

  return useQuery<ThreadListResponse>({
    queryKey,
    queryFn: ({ signal }) =>
      sdk.threads.list({
        ...rest,
        projectId: requireThreadId(projectId ?? "", "useThreads"),
        signal,
      }),
    enabled,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}

interface UseChildThreadsArgs {
  enabled: boolean;
  parentThreadId: string | undefined;
}

export interface UseChildThreadsResult {
  data: ThreadListResponse | undefined;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
}

/**
 * Live children of one parent across every project. A child may live in a
 * different project than its parent, so this list is keyed by parent only and
 * never derived from a project-scoped thread list.
 *
 * The sidebar bootstrap already carries every visible unarchived thread across
 * every project, so while that cache is populated the children are derived
 * from it (no per-thread-open `GET /threads?parentThreadId=`). The targeted
 * list request is the fallback for surfaces mounted without the sidebar cache.
 */
export function useChildThreads({
  enabled: enabledOption,
  parentThreadId,
}: UseChildThreadsArgs): UseChildThreadsResult {
  const enabled = enabledOption && Boolean(parentThreadId);
  useThreadListRealtimeSubscription({ enabled });
  const selectChildren = useCallback(
    (threads: ThreadListEntry[]) =>
      parentThreadId === undefined
        ? EMPTY_THREAD_LIST
        : filterProjectThreadSubset(threads, { parentThreadId }),
    [parentThreadId],
  );
  const { data: sidebarChildren, isBootstrapPending } =
    useSidebarNavigationThreadSelection(selectChildren);
  // A cold open (deep link) mounts the thread while the app shell's bootstrap
  // is still in flight; wait for it instead of racing it with a list request.
  const shouldFetch =
    enabled && sidebarChildren === undefined && !isBootstrapPending;
  const fallbackQuery = useQuery<ThreadListResponse>({
    queryKey:
      shouldFetch && parentThreadId
        ? threadListQueryKey({ archived: false, parentThreadId })
        : disabledThreadListQueryKey({ archived: false }),
    queryFn: ({ signal }) =>
      sdk.threads.list({
        archived: false,
        parentThreadId: requireThreadId(
          parentThreadId ?? "",
          "useChildThreads",
        ),
        signal,
      }),
    enabled: shouldFetch,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
  const derivedChildren = enabled ? sidebarChildren : undefined;
  if (derivedChildren !== undefined) {
    return {
      data: derivedChildren,
      isError: false,
      isFetching: false,
      isLoading: false,
    };
  }
  const waitingForBootstrap = enabled && isBootstrapPending;
  return {
    data: fallbackQuery.data,
    isError: fallbackQuery.isError,
    isFetching: fallbackQuery.isFetching || waitingForBootstrap,
    isLoading: fallbackQuery.isLoading || waitingForBootstrap,
  };
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
  const canDeriveFromActiveProjectThreads = true;
  const activeProjectThreadListQueryKey =
    enabled && projectId
      ? threadListQueryKey({ archived: false, projectId })
      : disabledThreadListQueryKey(
          projectId ? { archived: false, projectId } : { archived: false },
        );
  const activeProjectThreadListIsCached =
    canDeriveFromActiveProjectThreads &&
    enabled &&
    projectId !== undefined &&
    queryClient.getQueryData<ThreadListResponse>(
      threadListQueryKey({ archived: false, projectId }),
    ) !== undefined;
  const activeProjectThreadsQuery = useQuery<ThreadListResponse>({
    queryKey: activeProjectThreadListQueryKey,
    queryFn: ({ signal }) =>
      sdk.threads.list({
        archived: false,
        projectId: requireThreadId(projectId ?? "", "useProjectThreadSubset"),
        signal,
      }),
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

/**
 * Threads offered by the `@` mention picker. The sidebar-navigation cache
 * already holds every visible unarchived thread, so while it is populated the
 * candidates are derived from it and no `GET /threads?limit=200` is issued.
 * The list request is the fallback for surfaces mounted without that cache.
 */
export function useThreadMentionCandidates({
  enabled: enabledOption,
}: UseThreadMentionCandidatesArgs): UseThreadMentionCandidatesResult {
  const queryClient = useQueryClient();
  const enabled = enabledOption ?? true;
  useThreadListRealtimeSubscription({ enabled });
  const { data: sidebarCandidates, isBootstrapPending } =
    useSidebarNavigationThreadSelection(selectThreadMentionCandidates);
  const shouldFetch =
    enabled && sidebarCandidates === undefined && !isBootstrapPending;
  const queryKey = shouldFetch
    ? threadListQueryKey(THREAD_MENTION_CANDIDATE_FILTERS)
    : disabledThreadListQueryKey(THREAD_MENTION_CANDIDATE_FILTERS);
  const threadsQuery = useQuery<ThreadListResponse>({
    queryKey,
    queryFn: ({ signal }) =>
      sdk.threads.list({ ...THREAD_MENTION_CANDIDATE_FILTERS, signal }),
    enabled: shouldFetch,
    placeholderData: (previousData) =>
      previousData ??
      getThreadMentionCandidatePlaceholder({
        limit: THREAD_MENTION_CANDIDATE_LIMIT,
        queryClient,
      }),
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
  const derivedCandidates = enabled ? sidebarCandidates : undefined;

  if (derivedCandidates !== undefined) {
    return {
      data: derivedCandidates,
      isError: false,
      isFetching: false,
      isLoading: false,
    };
  }
  const waitingForBootstrap = enabled && isBootstrapPending;
  return {
    data: threadsQuery.data,
    isError: threadsQuery.isError,
    isFetching: threadsQuery.isFetching || waitingForBootstrap,
    isLoading: threadsQuery.isLoading || waitingForBootstrap,
  };
}

export function useThreadSearch({
  active,
  limitPerGroup = THREAD_SEARCH_LIMIT_PER_GROUP,
  query,
}: UseThreadSearchArgs): UseThreadSearchResult {
  const [debouncedRawQuery] = useDebounceValue(
    query,
    THREAD_SEARCH_DEBOUNCE_MS,
  );
  const trimmedQuery = query.trim();
  const debouncedQuery = debouncedRawQuery.trim();
  const liveQueryIsSearchable = hasThreadSearchableQuery(trimmedQuery);
  const hasSearchableQuery = hasThreadSearchableQuery(debouncedQuery);
  const isDebouncing =
    active && liveQueryIsSearchable && trimmedQuery !== debouncedQuery;
  const enabled = active && liveQueryIsSearchable && hasSearchableQuery;
  const threadSearchQuery = useQuery<ThreadSearchResponse>({
    queryKey: threadSearchQueryKey({ limitPerGroup, query: debouncedQuery }),
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

export function useThread(id: string, options?: QueryOptions) {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadResponse>({
    queryKey: threadQueryKey(id),
    queryFn: ({ signal }) =>
      sdk.threads.get({
        threadId: requireThreadId(id, "useThread"),
        signal,
      }),
    enabled,
    staleTime: THREAD_DETAIL_STALE_TIME_MS,
    refetchOnMount: options?.refetchOnMount ?? true,
    retry: shouldRetryTransientReadQuery,
    retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
    placeholderData: (previousData, previousQuery) =>
      resolveThreadPlaceholder(previousData, previousQuery?.queryKey, id) ??
      liftThreadListPlaceholder(
        getCachedThreadListPlaceholder(queryClient, id),
      ),
  });
}

// A thread primed from the sidebar list cache has no spawn-policy flag (the
// list response omits it). Conservatively hide the spawn affordance on the
// placeholder; the real single-thread response, which carries the server-
// computed value, resolves moments later.
function liftThreadListPlaceholder(
  thread: ThreadListEntry | undefined,
): ThreadResponse | undefined {
  if (thread === undefined) {
    return undefined;
  }
  return {
    ...thread,
    activeBackgroundAgentCount: thread.activity.activeBackgroundAgentCount,
    canSpawnChild: false,
  };
}

export function useThreadDetailBootstrap(
  id: string,
  options?: ThreadDetailBootstrapQueryOptions,
) {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadWithIncludesResponse>({
    queryKey: threadDetailBootstrapQueryKey(id),
    queryFn: async ({ signal }) => {
      const threadId = requireThreadId(id, "useThreadDetailBootstrap");
      const timelinePrefetch = options?.timelinePrefetch ?? false;

      // The thread shell and timeline are independent reads. Starting the
      // timeline only after the bootstrap completes adds a full network
      // round-trip to every cold thread open, which is especially visible
      // through bb connect's edge + tunnel path.
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
    enabled,
    staleTime: Infinity,
    retry: shouldRetryTransientReadQuery,
    retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
  });
}

export function useThreadQueuedMessages(
  id: string,
  options?: ThreadQueuedMessagesQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadQueuedMessageListResponse>({
    queryKey: threadQueuedMessagesQueryKey(id),
    queryFn: ({ signal }) =>
      sdk.threads.queuedMessages.list({
        threadId: requireThreadId(id, "useThreadQueuedMessages"),
        signal,
      }),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: true,
    staleTime: options?.staleTime,
  });
}

export function useThreadPromptHistory(
  id: string,
  options?: ThreadPromptHistoryQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<PromptHistoryResponse>({
    queryKey: threadPromptHistoryQueryKey(id),
    queryFn: ({ signal }) =>
      sdk.threads.promptHistory({
        threadId: requireThreadId(id, "useThreadPromptHistory"),
        signal,
      }),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    staleTime: options?.staleTime ?? PROMPT_HISTORY_STALE_TIME_MS,
  });
}

export function useThreadPendingInteractions(
  id: string,
  options?: ThreadPendingInteractionsQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadPendingInteractionsResponse>({
    queryKey: threadPendingInteractionsQueryKey(id),
    queryFn: ({ signal }) =>
      sdk.threads.interactions.list({
        threadId: requireThreadId(id, "useThreadPendingInteractions"),
        signal,
      }),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
    staleTime: options?.staleTime,
  });
}

export function useThreadStorageFiles(
  id: string,
  listOptions: ThreadStorageFileListOptions,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadStorageFileListResponse>({
    queryKey: threadStorageFilesQueryKey(id, listOptions),
    queryFn: ({ signal }) => {
      const query = listOptions.query?.trim() ?? "";
      return sdk.threads.storageFiles({
        limit: String(listOptions.limit),
        ...(query.length > 0 ? { query } : {}),
        threadId: requireThreadId(id, "useThreadStorageFiles"),
        signal,
      });
    },
    enabled,
    // Subscriptions can be absent while no UI is listening, so remount must
    // establish a fresh baseline instead of trusting cached data.
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  });
}

export function useThreadStoragePaths(
  id: string,
  listOptions: PathListOptions,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadStoragePathListResponse>({
    queryKey: threadStoragePathsQueryKey(id, listOptions),
    queryFn: ({ signal }) => {
      const query = listOptions.query?.trim() ?? "";
      return sdk.threads.storagePaths({
        includeDirectories: listOptions.includeDirectories ? "true" : "false",
        includeFiles: listOptions.includeFiles ? "true" : "false",
        limit: String(listOptions.limit),
        ...(query.length > 0 ? { query } : {}),
        threadId: requireThreadId(id, "useThreadStoragePaths"),
        signal,
      });
    },
    enabled,
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
    placeholderData: (previousData) => previousData,
  });
}

export function useThreadStorageFilePreview(
  id: string,
  path: string | null,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id) && Boolean(path);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<FilePreview>({
    queryKey: threadStorageFilePreviewQueryKey(id, path),
    queryFn: ({ signal }) =>
      api.getThreadStorageFilePreview(
        requireThreadId(id, "useThreadStorageFilePreview"),
        path ?? "",
        signal,
      ),
    enabled,
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}

export function useThreadHostFilePreview(
  id: string,
  environmentId: string | null | undefined,
  path: string | null,
  options?: QueryOptions,
) {
  const enabled =
    (options?.enabled ?? true) &&
    Boolean(id) &&
    Boolean(environmentId) &&
    Boolean(path);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<FilePreview>({
    queryKey: threadHostFilePreviewQueryKey(id, environmentId, path),
    queryFn: ({ signal }) =>
      api.getThreadHostFilePreview(
        requireThreadId(id, "useThreadHostFilePreview"),
        path ?? "",
        signal,
      ),
    enabled,
    ...RESUME_REFETCH_QUERY_POLICY,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}

/**
 * Resolve a timeline response into the full window to cache. A `delta` response
 * is applied to the window we already hold (preserving unchanged row identity);
 * a full response is returned as-is. Falls back to a full fetch if the delta's
 * base is stale (should not happen, since the server only sends a delta when it
 * can reconstruct our exact window).
 */
async function mergeThreadTimelineDelta(
  previous: ThreadTimelineResponse | undefined,
  response: ThreadTimelineResponse,
  fetchFull: () => Promise<ThreadTimelineResponse>,
): Promise<ThreadTimelineResponse> {
  if (response.delta === undefined) {
    return response;
  }
  const merged = previous
    ? applyTimelineDelta(previous.rows, response.delta)
    : null;
  if (merged !== null) {
    return { ...response, rows: merged, delta: undefined };
  }
  return fetchFull();
}

interface FetchThreadTimelineArgs {
  queryClient: QueryClient;
  signal: AbortSignal;
  threadId: string;
}

/**
 * First-window size requested on compact viewports. Phones show a handful of
 * segments above the fold, so the 20-segment server default mostly ships rows
 * the user scrolls to later (older pages still load on demand). The server
 * keys its delta cache on the page request, so a stable per-client limit keeps
 * `afterSequence` deltas working.
 */
export const COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT = 8;

export function resolveThreadTimelineSegmentLimit(): number | undefined {
  return getMediaQuerySnapshot(COMPACT_VIEWPORT_QUERY)
    ? COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT
    : undefined;
}

async function fetchThreadTimeline({
  queryClient,
  signal,
  threadId,
}: FetchThreadTimelineArgs): Promise<ThreadTimelineResponse> {
  // Ask for a delta against the window we already hold. The server only
  // honors it when it can still reconstruct exactly what we have; otherwise
  // it returns the full window.
  const queryKey = threadTimelineQueryKey(threadId);
  const previous = queryClient.getQueryData<ThreadTimelineResponse>(queryKey);
  const segmentLimit = resolveThreadTimelineSegmentLimit();
  const pageArgs =
    segmentLimit === undefined ? {} : { segmentLimit: String(segmentLimit) };
  const response = await sdk.threads.timeline({
    threadId,
    signal,
    ...pageArgs,
    ...(previous?.maxSeq !== undefined
      ? { afterSequence: String(previous.maxSeq) }
      : {}),
  });
  return mergeThreadTimelineDelta(previous, response, () =>
    sdk.threads.timeline({ threadId, signal, ...pageArgs }),
  );
}

export function useThreadTimeline(
  id: string,
  options?: ThreadTimelineQueryOptions,
) {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadTimelineResponse>({
    queryKey: threadTimelineQueryKey(id),
    queryFn: async ({ signal }) => {
      const threadId = requireThreadId(id, "useThreadTimeline");
      return fetchThreadTimeline({
        queryClient,
        signal,
        threadId,
      });
    },
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    ...(options?.staleTime === undefined
      ? {}
      : { staleTime: options.staleTime }),
    retry: shouldRetryTransientReadQuery,
    retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
    placeholderData: (previousData, previousQuery) =>
      resolveThreadTimelinePlaceholder(
        previousData,
        previousQuery?.queryKey,
        id,
      ),
  });
}

/**
 * Full conversation outline (every user/agent message) for a thread's
 * table-of-contents minimap. Unlike {@link useThreadTimeline}, this is not
 * paginated — it always reflects the whole thread — so the minimap can show
 * messages that have not yet been scrolled/paged into the loaded window. It is
 * invalidated by the same realtime `events-appended` signal as the timeline
 * window, so it stays in sync as new messages arrive.
 */
export function useThreadConversationOutline(
  id: string,
  options?: ThreadTimelineQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadConversationOutlineResponse>({
    queryKey: threadConversationOutlineQueryKey(id),
    queryFn: async ({ signal }) => {
      const threadId = requireThreadId(id, "useThreadConversationOutline");
      return sdk.threads.conversationOutline({ threadId, signal });
    },
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    ...(options?.staleTime === undefined
      ? {}
      : { staleTime: options.staleTime }),
  });
}

export function useThreadTimelineTurnSummaryDetails(
  identity: ThreadTimelineTurnSummaryDetailsQueryIdentity,
  options?: ThreadTimelineTurnSummaryDetailsQueryOptions,
) {
  return useQuery<TimelineTurnSummaryDetailsResponse>({
    queryKey: threadTimelineTurnSummaryDetailsQueryKey(identity),
    queryFn: ({ signal }) =>
      sdk.threads.timelineTurnSummaryDetails({
        threadId: requireThreadId(
          identity.threadId,
          "useThreadTimelineTurnSummaryDetails",
        ),
        sourceSeqEnd: String(identity.sourceSeqEnd),
        sourceSeqStart: String(identity.sourceSeqStart),
        turnId: identity.turnId,
        signal,
      }),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(identity.threadId) &&
      Boolean(identity.turnId),
    meta: {
      errorMessage: "Failed to load turn summary details.",
      showErrorToast: false,
    },
    refetchOnMount: options?.refetchOnMount ?? true,
    staleTime: options?.staleTime ?? Infinity,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}

export function getLatestPendingInteraction(
  interactions: readonly PendingInteraction[] | undefined,
): PendingInteraction | null {
  if (!interactions || interactions.length === 0) {
    return null;
  }

  const [firstInteraction, ...restInteractions] = interactions;
  return restInteractions.reduce<PendingInteraction>(
    (latest, interaction) =>
      interaction.createdAt > latest.createdAt ? interaction : latest,
    firstInteraction,
  );
}
