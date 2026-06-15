import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type { PendingInteraction } from "@bb/domain";
import type {
  AutomationsOverviewResponse,
  PromptHistoryResponse,
  ThreadQueuedMessageListResponse,
  ThreadListResponse,
  ThreadPendingInteractionsResponse,
  ThreadResponse,
  ThreadSchedule,
  ThreadWithIncludesResponse,
  ThreadStorageFileListResponse,
  ThreadStoragePathListResponse,
  ThreadTimelineFeedResponse,
  TimelineFeedDetailPart,
  TimelineFeedDetailRef,
  TimelineRowDetailResponse,
  TimelineTurnSummaryDetailsResponse,
  TimelineWorkOutputDetailResponse,
} from "@bb/server-contract";
import type { ThreadListFilters, FilePreview } from "@/lib/api";
import type { PathListOptions } from "@/lib/path-list-options";
import type { ThreadStorageFileListOptions } from "@/lib/thread-storage-files";
import * as api from "@/lib/api";
import {
  useProjectListRealtimeSubscription,
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
  resolveThreadTimelineFeedPlaceholder,
} from "./query-placeholders";
import {
  PROMPT_HISTORY_STALE_TIME_MS,
  requireEnabledQueryArg,
} from "./query-helpers";
import {
  archivedThreadsListQueryKey,
  automationsOverviewQueryKey,
  disabledThreadListQueryKey,
  threadDetailBootstrapQueryKey,
  threadQueuedMessagesQueryKey,
  threadListQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadSchedulesQueryKey,
  threadStorageFilesQueryKey,
  threadStoragePathsQueryKey,
  threadStorageFilePreviewQueryKey,
  threadHostFilePreviewQueryKey,
  threadTimelineFeedQueryKey,
  threadTimelineRowDetailQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
  threadTimelineWorkOutputDetailQueryKey,
  threadsQueryKey,
  type ThreadTimelineRowDetailQueryIdentity,
  type ThreadTimelineWorkOutputDetailQueryIdentity,
  type ThreadTimelineTurnSummaryDetailsQueryIdentity,
  type ArchivedThreadsKindFilter,
} from "./query-keys";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";
import { ingestThreadDetailBootstrap } from "../cache-owners/thread-detail-cache-owner";

interface QueryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
}

const THREAD_LIST_STALE_TIME_MS = 10_000;
export const THREAD_MENTION_CANDIDATE_LIMIT = 200;

interface ThreadDetailBootstrapQueryOptions extends QueryOptions {
  composerBootstrapPrefetch?: boolean;
  timelinePrefetch?: boolean;
}

type ThreadTimelineFeedQueryOptions = QueryOptions;

type ThreadTimelineRowDetailQueryOptions = QueryOptions;

type ThreadTimelineTurnSummaryDetailsQueryOptions = QueryOptions;

type ThreadTimelineWorkOutputDetailQueryOptions = QueryOptions;

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
}

export interface UseThreadMentionCandidatesResult {
  data: ThreadListResponse | undefined;
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

export interface ThreadTimelineRowDetailRequest {
  detail: TimelineFeedDetailRef | null;
  parts: readonly TimelineFeedDetailPart[];
  threadId: string | undefined;
}

interface RequestedTimelineRowDetailPartsArgs {
  detail: TimelineFeedDetailRef | null;
  parts: readonly TimelineFeedDetailPart[];
}

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

function requestedTimelineRowDetailParts({
  detail,
  parts,
}: RequestedTimelineRowDetailPartsArgs): TimelineFeedDetailPart[] {
  if (detail === null) {
    return [];
  }
  const availableParts = new Set(detail.parts);
  return parts.filter((part) => availableParts.has(part));
}

function buildThreadTimelineRowDetailQueryIdentity({
  detail,
  parts,
  threadId,
}: ThreadTimelineRowDetailRequest): ThreadTimelineRowDetailQueryIdentity {
  return {
    detail: detail ?? {
      rowKey: "",
      source: {
        start: 0,
        end: 0,
      },
      parts: [],
    },
    parts: requestedTimelineRowDetailParts({ detail, parts }),
    threadId: threadId ?? "",
  };
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

export interface UseArchivedThreadsFilters {
  projectId: string | undefined;
  kind: ArchivedThreadsKindFilter;
}

interface ArchivedThreadsApiFilters {
  hasParent?: ThreadListFilters["hasParent"];
}

function archivedThreadsKindToApiFilters(
  kind: ArchivedThreadsKindFilter,
): ArchivedThreadsApiFilters {
  if (kind === "root") return { hasParent: false };
  if (kind === "child") return { hasParent: true };
  return {};
}

export function useArchivedThreads(
  filters: UseArchivedThreadsFilters,
  options?: QueryOptions,
) {
  const { projectId, kind } = filters;
  const enabled = (options?.enabled ?? true) && Boolean(projectId);
  const apiFilters = archivedThreadsKindToApiFilters(kind);
  useThreadListRealtimeSubscription({ enabled });

  return useInfiniteQuery<
    ThreadListResponse,
    Error,
    { pageParams: number[]; pages: ThreadListResponse[] },
    ReturnType<typeof archivedThreadsListQueryKey>,
    number
  >({
    queryKey: archivedThreadsListQueryKey({
      projectId: projectId ?? "",
      kind,
    }),
    queryFn: ({ pageParam, signal }) =>
      api.listThreads(
        {
          projectId: requireThreadId(projectId ?? "", "useArchivedThreads"),
          archived: true,
          ...apiFilters,
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

export function useThread(id: string, options?: QueryOptions) {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadResponse>({
    queryKey: threadQueryKey(id),
    queryFn: () => api.getThread(requireThreadId(id, "useThread")),
    enabled,
    staleTime: 5_000,
    refetchOnMount: options?.refetchOnMount ?? true,
    placeholderData: (previousData, previousQuery) =>
      resolveThreadPlaceholder(previousData, previousQuery?.queryKey, id) ??
      getCachedThreadListPlaceholder(queryClient, id),
  });
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
    queryFn: async () => {
      const thread = await api.getThreadWithEnvironmentHost(
        requireThreadId(id, "useThreadDetailBootstrap"),
      );
      ingestThreadDetailBootstrap({
        composerBootstrapPrefetch: options?.composerBootstrapPrefetch ?? false,
        queryClient,
        thread,
        timelinePrefetch: options?.timelinePrefetch ?? false,
      });
      return thread;
    },
    enabled,
    staleTime: Infinity,
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
    queryFn: () =>
      api.listThreadQueuedMessages(
        requireThreadId(id, "useThreadQueuedMessages"),
      ),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
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
    refetchOnWindowFocus: false,
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
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
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
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
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
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
}

export function useAutomationsOverview(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<AutomationsOverviewResponse>({
    queryKey: automationsOverviewQueryKey(),
    queryFn: ({ signal }) => api.listAutomationsOverview(signal),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    staleTime: options?.staleTime,
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
    refetchOnWindowFocus: false,
  });
}

export function useThreadSchedules(id: string, options?: QueryOptions) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadSchedule[]>({
    queryKey: threadSchedulesQueryKey(id),
    queryFn: ({ signal }) =>
      api.listThreadSchedules(
        requireThreadId(id, "useThreadSchedules"),
        signal,
      ),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    staleTime: options?.staleTime,
  });
}

export function useThreadTimelineFeed(
  id: string,
  options?: ThreadTimelineFeedQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadTimelineFeedResponse>({
    queryKey: threadTimelineFeedQueryKey(id),
    queryFn: () =>
      api.getThreadTimelineFeed({
        id: requireThreadId(id, "useThreadTimelineFeed"),
      }),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    ...(options?.staleTime === undefined
      ? {}
      : { staleTime: options.staleTime }),
    placeholderData: (previousData, previousQuery) =>
      resolveThreadTimelineFeedPlaceholder(
        previousData,
        previousQuery?.queryKey,
        id,
      ),
  });
}

export function useThreadTimelineRowDetail(
  request: ThreadTimelineRowDetailRequest,
  options?: ThreadTimelineRowDetailQueryOptions,
) {
  const identity = buildThreadTimelineRowDetailQueryIdentity(request);
  return useQuery<TimelineRowDetailResponse>({
    queryKey: threadTimelineRowDetailQueryKey(identity),
    queryFn: () =>
      api.getThreadTimelineRowDetail({
        detail: identity.detail,
        id: requireThreadId(identity.threadId, "useThreadTimelineRowDetail"),
        parts: identity.parts,
      }),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(request.threadId) &&
      request.detail !== null &&
      identity.parts.length > 0,
    meta: {
      errorMessage: "Failed to load timeline row detail.",
      showErrorToast: false,
    },
    refetchOnMount: options?.refetchOnMount ?? true,
    staleTime: options?.staleTime ?? Infinity,
  });
}

export function useThreadTimelineTurnSummaryDetails(
  identity: ThreadTimelineTurnSummaryDetailsQueryIdentity,
  options?: ThreadTimelineTurnSummaryDetailsQueryOptions,
) {
  return useQuery<TimelineTurnSummaryDetailsResponse>({
    queryKey: threadTimelineTurnSummaryDetailsQueryKey(identity),
    queryFn: () =>
      api.getThreadTimelineTurnSummaryDetails({
        id: requireThreadId(
          identity.threadId,
          "useThreadTimelineTurnSummaryDetails",
        ),
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

export function useThreadTimelineWorkOutputDetail(
  identity: ThreadTimelineWorkOutputDetailQueryIdentity,
  options?: ThreadTimelineWorkOutputDetailQueryOptions,
) {
  return useQuery<TimelineWorkOutputDetailResponse>({
    queryKey: threadTimelineWorkOutputDetailQueryKey(identity),
    queryFn: () =>
      api.getThreadTimelineWorkOutputDetail({
        callId: identity.callId,
        id: requireThreadId(
          identity.threadId,
          "useThreadTimelineWorkOutputDetail",
        ),
        sourceSeqEnd: identity.sourceSeqEnd,
        sourceSeqStart: identity.sourceSeqStart,
        workKind: identity.workKind,
      }),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(identity.threadId) &&
      Boolean(identity.callId),
    meta: {
      errorMessage: "Failed to load timeline row output.",
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
