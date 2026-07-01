import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { useDebounceValue } from "usehooks-ts";
import type {
  PendingInteraction,
  ThreadWithRuntime,
} from "@bb/domain";
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
import type { ThreadListFilters, FilePreview } from "@/lib/api";
import type { PathListOptions } from "@/lib/path-list-options";
import type { ThreadStorageFileListOptions } from "@/lib/thread-storage-files";
import * as api from "@/lib/api";
import {
  useThreadDetailRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import {
  getCachedSidebarNavigationThreads,
  getCachedThreadListPlaceholder,
} from "../cache-owners/query-cache";
import {
  getCachedThreadLists,
  iterateThreadListCacheEntries,
} from "../cache-owners/thread-list-cache-data";
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
export const THREAD_MENTION_CANDIDATE_LIMIT = 200;
export const THREAD_SEARCH_DEBOUNCE_MS = 150;
export const THREAD_SEARCH_LIMIT_PER_GROUP = 20;
export const THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS = 2;

interface ThreadDetailBootstrapQueryOptions extends QueryOptions {
  timelinePrefetch?: boolean;
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
  excludeSideChats?: ThreadListFilters["excludeSideChats"];
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
  excludeSideChats: true,
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
  if (filters.excludeSideChats !== undefined) {
    listFilters.excludeSideChats = filters.excludeSideChats;
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
  if (
    filters.excludeSideChats &&
    (thread.originKind ?? thread.childOrigin) === "side-chat"
  ) {
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
  if ((thread.originKind ?? thread.childOrigin) === "side-chat") {
    return;
  }
  if (!candidatesById.has(thread.id)) {
    candidatesById.set(thread.id, thread);
  }
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
  /** Restrict to threads filed directly under this folder. */
  folderId?: string;
  /** Restrict to loose threads — those not filed under any folder. */
  unfiled?: boolean;
}

export function useArchivedThreads(
  filters: UseArchivedThreadsFilters,
  options?: QueryOptions,
) {
  const { projectId, folderId, unfiled } = filters;
  const enabled =
    (options?.enabled ?? true) &&
    (Boolean(projectId) || Boolean(folderId) || Boolean(unfiled));
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
      ...(folderId ? { folderId } : {}),
      ...(unfiled ? { unfiled: true } : {}),
    }),
    queryFn: ({ pageParam, signal }) =>
      api.listThreads(
        {
          ...(projectId ? { projectId } : {}),
          ...(folderId ? { folderId } : {}),
          ...(unfiled ? { unfiled: true } : {}),
          archived: true,
          limit: ARCHIVED_THREADS_PAGE_SIZE,
          offset: pageParam,
        },
        signal,
      ),
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
      api.listThreads(
        {
          ...rest,
          projectId: requireThreadId(projectId ?? "", "useThreads"),
        },
        signal,
      ),
    enabled,
    staleTime: THREAD_LIST_STALE_TIME_MS,
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
  const canDeriveFromActiveProjectThreads = !filters.excludeSideChats;
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
      api.listThreads(
        {
          archived: false,
          projectId: requireThreadId(projectId ?? "", "useProjectThreadSubset"),
        },
        signal,
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
  };
}

export function useThreadMentionCandidates({
  enabled: enabledOption,
}: UseThreadMentionCandidatesArgs): UseThreadMentionCandidatesResult {
  const queryClient = useQueryClient();
  const enabled = enabledOption ?? true;
  useThreadListRealtimeSubscription({ enabled });
  const queryKey = enabled
    ? threadListQueryKey(THREAD_MENTION_CANDIDATE_FILTERS)
    : disabledThreadListQueryKey(THREAD_MENTION_CANDIDATE_FILTERS);
  const threadsQuery = useQuery<ThreadListResponse>({
    queryKey,
    queryFn: ({ signal }) =>
      api.listThreads(THREAD_MENTION_CANDIDATE_FILTERS, signal),
    enabled,
    placeholderData: (previousData) =>
      previousData ??
      getThreadMentionCandidatePlaceholder({
        limit: THREAD_MENTION_CANDIDATE_LIMIT,
        queryClient,
      }),
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });

  return {
    data: threadsQuery.data,
    isError: threadsQuery.isError,
    isFetching: threadsQuery.isFetching,
    isLoading: threadsQuery.isLoading,
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
      api.searchThreads({ limitPerGroup, query: debouncedQuery }, signal),
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
      api.getThread(requireThreadId(id, "useThread"), signal),
    enabled,
    staleTime: 5_000,
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
  thread: ThreadWithRuntime | undefined,
): ThreadResponse | undefined {
  if (thread === undefined) {
    return undefined;
  }
  return { ...thread, canSpawnChild: false };
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
      const thread = await api.getThreadWithEnvironmentHost(
        requireThreadId(id, "useThreadDetailBootstrap"),
        signal,
      );
      ingestThreadDetailBootstrap({
        queryClient,
        thread,
        timelinePrefetch: options?.timelinePrefetch ?? false,
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
      api.listThreadQueuedMessages(
        requireThreadId(id, "useThreadQueuedMessages"),
        signal,
      ),
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
      api.listThreadPromptHistory(
        requireThreadId(id, "useThreadPromptHistory"),
        signal,
      ),
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
      api.listThreadPendingInteractions(
        requireThreadId(id, "useThreadPendingInteractions"),
        signal,
      ),
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
    queryFn: ({ signal }) =>
      api.listThreadStorageFiles({
        id: requireThreadId(id, "useThreadStorageFiles"),
        options: listOptions,
        signal,
      }),
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
    queryFn: ({ signal }) =>
      api.listThreadStoragePaths({
        id: requireThreadId(id, "useThreadStoragePaths"),
        options: listOptions,
        signal,
      }),
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
      // Ask for a delta against the window we already hold. The server only
      // honors it when it can still reconstruct exactly what we have; otherwise
      // it returns the full window.
      const previous = queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey(id),
      );
      const response = await api.getThreadTimeline({
        id: threadId,
        signal,
        ...(previous?.maxSeq !== undefined
          ? { afterSequence: previous.maxSeq }
          : {}),
      });
      return mergeThreadTimelineDelta(previous, response, () =>
        api.getThreadTimeline({ id: threadId, signal }),
      );
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
      return api.getThreadConversationOutline({ id: threadId, signal });
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
      api.getThreadTimelineTurnSummaryDetails({
        id: requireThreadId(
          identity.threadId,
          "useThreadTimelineTurnSummaryDetails",
        ),
        signal,
        sourceSeqEnd: identity.sourceSeqEnd,
        sourceSeqStart: identity.sourceSeqStart,
        turnId: identity.turnId,
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
