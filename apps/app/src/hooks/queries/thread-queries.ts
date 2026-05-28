import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type {
  Host,
  PendingInteraction,
  ResolvedThreadExecutionOptions,
  ThreadType,
} from "@bb/domain";
import type {
  PromptHistoryResponse,
  ThreadComposerBootstrapResponse,
  ThreadQueuedMessageListResponse,
  ThreadListResponse,
  ManagerTimelineView,
  ThreadPendingInteractionsResponse,
  ThreadResponse,
  ThreadWithIncludesResponse,
  ThreadStorageFileListResponse,
  ThreadStoragePathListResponse,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsRequest,
  TimelineTurnSummaryDetailsResponse,
  AppDetail,
  AppSummary,
} from "@bb/server-contract";
import type { ThreadListFilters, FilePreview } from "@/lib/api";
import type { PathListOptions } from "@/lib/path-list-options";
import type { ThreadStorageFileListOptions } from "@/lib/thread-storage-files";
import * as api from "@/lib/api";
import { getCachedThreadListPlaceholder } from "./query-cache";
import {
  resolveThreadPlaceholder,
  resolveThreadTimelinePlaceholder,
} from "./query-placeholders";
import {
  archivedThreadsListQueryKey,
  disabledThreadListQueryKey,
  environmentQueryKey,
  hostQueryKey,
  hostsQueryKey,
  systemExecutionOptionsQueryKey,
  threadComposerBootstrapQueryKey,
  threadDetailBootstrapQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadQueuedMessagesQueryKey,
  threadListQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadStorageFilesQueryKey,
  threadStoragePathsQueryKey,
  threadStorageFilePreviewQueryKey,
  threadAppMarkdownPreviewQueryKey,
  threadAppQueryKey,
  threadAppsQueryKey,
  threadHostFilePreviewQueryKey,
  threadTimelineQueryKey,
  type ArchivedThreadsKindFilter,
} from "./query-keys";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";

interface QueryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
}

const THREAD_LIST_STALE_TIME_MS = 10_000;

interface ThreadComposerBootstrapQueryOptions extends QueryOptions {
  environmentId?: string;
  providerId?: string;
}

interface ThreadTimelinePrefetchOptions {
  managerTimelineView?: ManagerTimelineView;
}

interface ThreadDetailBootstrapQueryOptions extends QueryOptions {
  composerBootstrapPrefetch?: boolean;
  timelinePrefetch?: ThreadTimelinePrefetchOptions;
}

interface ThreadTimelineQueryOptions extends QueryOptions {
  managerTimelineView?: ManagerTimelineView;
}

type HostList = Host[];
type HostListQueryData = HostList | undefined;

interface UpsertHostListArgs {
  host: Host;
  hosts: HostListQueryData;
}

interface SeedThreadComposerBootstrapCachesArgs {
  bootstrap: ThreadComposerBootstrapResponse;
  environmentId: string | null;
  providerId: string | null;
  queryClient: QueryClient;
  threadId: string;
}

export interface UseThreadsFilters extends Omit<
  ThreadListFilters,
  "archived" | "projectId"
> {
  archived: boolean;
  projectId?: string;
}

export interface ProjectThreadSubsetFilters {
  parentThreadId?: string;
  type?: ThreadType;
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

interface BuildThreadSubsetListFiltersArgs {
  filters: ProjectThreadSubsetFilters;
  projectId: string | undefined;
}

type ThreadListItem = ThreadListResponse[number];

interface ThreadTimelineTurnSummaryDetailsMutationRequest extends TimelineTurnSummaryDetailsRequest {
  id: string;
}

function requireThreadId(id: string, hookName: string): string {
  if (!id) {
    throw new Error(`${hookName}: thread id is required when query is enabled`);
  }

  return id;
}

function buildThreadSubsetListFilters({
  filters,
  projectId,
}: BuildThreadSubsetListFiltersArgs): UseThreadsFilters {
  const listFilters: UseThreadsFilters = {
    archived: false,
    projectId,
  };

  if (filters.parentThreadId !== undefined) {
    listFilters.parentThreadId = filters.parentThreadId;
  }
  if (filters.type !== undefined) {
    listFilters.type = filters.type;
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
  if (filters.type !== undefined && thread.type !== filters.type) {
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

export interface UseArchivedThreadsFilters {
  projectId: string | undefined;
  kind: ArchivedThreadsKindFilter;
}

interface ArchivedThreadsApiFilters {
  managed?: boolean;
  type?: ThreadListFilters["type"];
}

function archivedThreadsKindToApiFilters(
  kind: ArchivedThreadsKindFilter,
): ArchivedThreadsApiFilters {
  if (kind === "manager") return { type: "manager" };
  if (kind === "managed") return { managed: true, type: "standard" };
  if (kind === "unmanaged") return { managed: false, type: "standard" };
  return {};
}

export function useArchivedThreads(
  filters: UseArchivedThreadsFilters,
  options?: QueryOptions,
) {
  const { projectId, kind } = filters;
  const enabled = (options?.enabled ?? true) && Boolean(projectId);
  const apiFilters = archivedThreadsKindToApiFilters(kind);

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
  const { parentThreadId, type } = filters;
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
            parentThreadId,
            type,
          })
        : undefined,
    [activeProjectThreadsQuery.data, parentThreadId, type],
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

export function useThread(id: string, options?: QueryOptions) {
  const queryClient = useQueryClient();

  return useQuery<ThreadResponse>({
    queryKey: threadQueryKey(id),
    queryFn: () => api.getThread(requireThreadId(id, "useThread")),
    enabled: (options?.enabled ?? true) && Boolean(id),
    staleTime: 5_000,
    refetchOnMount: options?.refetchOnMount ?? true,
    placeholderData: (previousData, previousQuery) =>
      resolveThreadPlaceholder(previousData, previousQuery?.queryKey, id) ??
      getCachedThreadListPlaceholder(queryClient, id),
  });
}

function stripThreadIncludes(
  thread: ThreadWithIncludesResponse,
): ThreadResponse {
  const { environment, host, ...threadResponse } = thread;
  return threadResponse;
}

function upsertHostList({ host, hosts }: UpsertHostListArgs): HostList {
  if (!hosts) {
    return [host];
  }

  let found = false;
  const nextHosts = hosts.map((candidate) => {
    if (candidate.id !== host.id) {
      return candidate;
    }
    found = true;
    return host;
  });

  return found ? nextHosts : [...hosts, host];
}

function seedThreadComposerBootstrapCaches({
  bootstrap,
  environmentId,
  providerId,
  queryClient,
  threadId,
}: SeedThreadComposerBootstrapCachesArgs): void {
  queryClient.setQueryData(
    threadDefaultExecutionOptionsQueryKey(threadId),
    bootstrap.defaultExecutionOptions,
  );
  queryClient.setQueryData(
    threadQueuedMessagesQueryKey(threadId),
    bootstrap.queuedMessages,
  );
  queryClient.setQueryData(
    threadPromptHistoryQueryKey(threadId),
    bootstrap.promptHistory,
  );
  queryClient.setQueryData(
    threadPendingInteractionsQueryKey(threadId),
    bootstrap.pendingInteractions,
  );
  const resolvedProviderId =
    providerId ?? bootstrap.executionOptions.providers[0]?.id;
  if (resolvedProviderId) {
    queryClient.setQueryData(
      systemExecutionOptionsQueryKey({
        environmentId,
        providerId: resolvedProviderId,
      }),
      bootstrap.executionOptions,
    );
  }
}

export function useThreadDetailBootstrap(
  id: string,
  options?: ThreadDetailBootstrapQueryOptions,
) {
  const queryClient = useQueryClient();

  return useQuery<ThreadWithIncludesResponse>({
    queryKey: threadDetailBootstrapQueryKey(id),
    queryFn: async () => {
      const thread = await api.getThreadWithEnvironmentHost(
        requireThreadId(id, "useThreadDetailBootstrap"),
      );
      queryClient.setQueryData(
        threadQueryKey(thread.id),
        stripThreadIncludes(thread),
      );
      if (thread.environment) {
        queryClient.setQueryData(
          environmentQueryKey(thread.environment.id),
          thread.environment,
        );
      }
      if (thread.host) {
        const host = thread.host;
        queryClient.setQueryData(hostQueryKey(host.id), host);
        queryClient.setQueryData<HostList>(hostsQueryKey(), (hosts) =>
          upsertHostList({ host, hosts }),
        );
      }
      if (options?.timelinePrefetch) {
        const managerTimelineView =
          thread.type === "manager"
            ? options.timelinePrefetch.managerTimelineView
            : undefined;
        void queryClient.prefetchQuery({
          queryKey: threadTimelineQueryKey(thread.id, managerTimelineView),
          queryFn: () =>
            api.getThreadTimeline({
              id: thread.id,
              managerTimelineView,
            }),
        });
      }
      if (options?.composerBootstrapPrefetch) {
        const environmentId = thread.environmentId ?? null;
        const providerId = thread.providerId ?? null;
        void queryClient.prefetchQuery({
          queryKey: threadComposerBootstrapQueryKey(thread.id, environmentId),
          queryFn: async () => {
            const bootstrap = await api.getThreadComposerBootstrap(thread.id);
            seedThreadComposerBootstrapCaches({
              bootstrap,
              environmentId,
              providerId,
              queryClient,
              threadId: thread.id,
            });
            return bootstrap;
          },
        });
      }
      return thread;
    },
    enabled: (options?.enabled ?? true) && Boolean(id),
    staleTime: Infinity,
  });
}

export function useThreadComposerBootstrap(
  id: string,
  options?: ThreadComposerBootstrapQueryOptions,
) {
  const queryClient = useQueryClient();
  const environmentId = options?.environmentId ?? null;
  const providerId = options?.providerId ?? null;

  return useQuery<ThreadComposerBootstrapResponse>({
    queryKey: threadComposerBootstrapQueryKey(id, environmentId),
    queryFn: async () => {
      const bootstrap = await api.getThreadComposerBootstrap(
        requireThreadId(id, "useThreadComposerBootstrap"),
      );
      seedThreadComposerBootstrapCaches({
        bootstrap,
        environmentId,
        providerId,
        queryClient,
        threadId: id,
      });
      return bootstrap;
    },
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    ...(options?.staleTime === undefined
      ? {}
      : { staleTime: options.staleTime }),
  });
}

export function useThreadDefaultExecutionOptions(
  id: string,
  options?: QueryOptions,
) {
  return useQuery<ResolvedThreadExecutionOptions | null>({
    queryKey: threadDefaultExecutionOptionsQueryKey(id),
    queryFn: () =>
      api.getThreadDefaultExecutionOptions(
        requireThreadId(id, "useThreadDefaultExecutionOptions"),
      ),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    staleTime: options?.staleTime,
  });
}

export function useThreadQueuedMessages(id: string, options?: QueryOptions) {
  return useQuery<ThreadQueuedMessageListResponse>({
    queryKey: threadQueuedMessagesQueryKey(id),
    queryFn: () =>
      api.listThreadQueuedMessages(
        requireThreadId(id, "useThreadQueuedMessages"),
      ),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    staleTime: options?.staleTime,
  });
}

export function useThreadPromptHistory(id: string, options?: QueryOptions) {
  return useQuery<PromptHistoryResponse>({
    queryKey: threadPromptHistoryQueryKey(id),
    queryFn: ({ signal }) =>
      api.listThreadPromptHistory(
        requireThreadId(id, "useThreadPromptHistory"),
        signal,
      ),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount: options?.refetchOnMount ?? true,
    staleTime: options?.staleTime ?? 10_000,
  });
}

export function useThreadPendingInteractions(
  id: string,
  options?: QueryOptions,
) {
  return useQuery<ThreadPendingInteractionsResponse>({
    queryKey: threadPendingInteractionsQueryKey(id),
    queryFn: ({ signal }) =>
      api.listThreadPendingInteractions(
        requireThreadId(id, "useThreadPendingInteractions"),
        signal,
      ),
    enabled: (options?.enabled ?? true) && Boolean(id),
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
  return useQuery<ThreadStorageFileListResponse>({
    queryKey: threadStorageFilesQueryKey(id, listOptions),
    queryFn: ({ signal }) =>
      api.listThreadStorageFiles({
        id: requireThreadId(id, "useThreadStorageFiles"),
        options: listOptions,
        signal,
      }),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnWindowFocus: false,
  });
}

export function useThreadStoragePaths(
  id: string,
  listOptions: PathListOptions,
  options?: QueryOptions,
) {
  return useQuery<ThreadStoragePathListResponse>({
    queryKey: threadStoragePathsQueryKey(id, listOptions),
    queryFn: ({ signal }) =>
      api.listThreadStoragePaths({
        id: requireThreadId(id, "useThreadStoragePaths"),
        options: listOptions,
        signal,
      }),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}

export function useThreadStorageFilePreview(
  id: string,
  path: string | null,
  options?: QueryOptions,
) {
  return useQuery<FilePreview>({
    queryKey: threadStorageFilePreviewQueryKey(id, path),
    queryFn: ({ signal }) =>
      api.getThreadStorageFilePreview(
        requireThreadId(id, "useThreadStorageFilePreview"),
        path ?? "",
        signal,
      ),
    enabled: (options?.enabled ?? true) && Boolean(id) && Boolean(path),
    refetchOnWindowFocus: false,
  });
}

/**
 * Thread apps rarely change within a session and are read from both the sidebar
 * (a query per manager row) and the thread detail view. A shared default stale
 * window lets navigation reuse a recent sidebar fetch instead of refetching on
 * detail mount; callers can still override `staleTime` explicitly.
 */
const THREAD_APPS_STALE_TIME_MS = 30_000;

export function useThreadApps(id: string, options?: QueryOptions) {
  return useQuery<AppSummary[]>({
    queryKey: threadAppsQueryKey(id),
    queryFn: ({ signal }) =>
      api.listThreadApps(requireThreadId(id, "useThreadApps"), signal),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    staleTime: options?.staleTime ?? THREAD_APPS_STALE_TIME_MS,
  });
}

export function useThreadApp(
  id: string,
  appId: string | null | undefined,
  options?: QueryOptions,
) {
  const queryClient = useQueryClient();

  return useQuery<AppDetail>({
    queryKey: threadAppQueryKey(id, appId ?? ""),
    queryFn: ({ signal }) =>
      api.getThreadApp(
        requireThreadId(id, "useThreadApp"),
        appId ?? "",
        signal,
      ),
    enabled: (options?.enabled ?? true) && Boolean(id) && Boolean(appId),
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    placeholderData: () =>
      queryClient
        .getQueryData<AppSummary[]>(threadAppsQueryKey(id))
        ?.find((app) => app.id === appId),
    staleTime: options?.staleTime,
  });
}

export function useThreadAppMarkdownPreview(
  id: string,
  appId: string | null | undefined,
  entryPath: string | null | undefined,
  options?: QueryOptions,
) {
  return useQuery<FilePreview>({
    queryKey: threadAppMarkdownPreviewQueryKey(id, appId ?? "", entryPath),
    queryFn: ({ signal }) =>
      api.getThreadAppMarkdownPreview(
        requireThreadId(id, "useThreadAppMarkdownPreview"),
        appId ?? "",
        entryPath ?? "",
        signal,
      ),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(id) &&
      Boolean(appId) &&
      Boolean(entryPath),
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
  return useQuery<FilePreview>({
    queryKey: threadHostFilePreviewQueryKey(id, environmentId, path),
    queryFn: ({ signal }) =>
      api.getThreadHostFilePreview(
        requireThreadId(id, "useThreadHostFilePreview"),
        path ?? "",
        signal,
      ),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(id) &&
      Boolean(environmentId) &&
      Boolean(path),
    refetchOnWindowFocus: false,
  });
}

export function useThreadTimeline(
  id: string,
  options?: ThreadTimelineQueryOptions,
) {
  const managerTimelineView = options?.managerTimelineView;

  return useQuery<ThreadTimelineResponse>({
    queryKey: threadTimelineQueryKey(id, managerTimelineView),
    queryFn: () =>
      api.getThreadTimeline({
        id: requireThreadId(id, "useThreadTimeline"),
        managerTimelineView,
      }),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount: options?.refetchOnMount ?? true,
    ...(options?.staleTime === undefined
      ? {}
      : { staleTime: options.staleTime }),
    placeholderData: (previousData, previousQuery) =>
      resolveThreadTimelinePlaceholder(
        previousData,
        previousQuery?.queryKey,
        id,
        managerTimelineView,
      ),
  });
}

export function useThreadTimelineTurnSummaryDetails() {
  return useMutation({
    meta: {
      errorMessage: "Failed to load turn summary details.",
      showErrorToast: false,
    },
    mutationFn: (
      request: ThreadTimelineTurnSummaryDetailsMutationRequest,
    ): Promise<TimelineTurnSummaryDetailsResponse> =>
      api.getThreadTimelineTurnSummaryDetails(request),
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
