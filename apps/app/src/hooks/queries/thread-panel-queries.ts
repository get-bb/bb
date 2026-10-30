import { prependOlderTimelineRows } from "@bb/client-core";
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type NotifyOnChangeProps,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";
import type {
  PromptHistoryResponse,
  ThreadQueuedMessageListResponse,
  ThreadConversationOutlineResponse,
  ThreadStorageFileListResponse,
  ThreadStorageLocationResponse,
  ThreadStoragePathListResponse,
  ThreadTimelineResponse,
  TimelineRow,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import type { FilePreview } from "@bb/client-core";
import type { PathListOptions } from "@/lib/path-list-options";
import type { ThreadStorageFileListOptions } from "@/lib/thread-storage-files";
import * as api from "@/lib/api";
import { sdk } from "@/lib/sdk";
import {
  useThreadDetailRealtimeSubscription,
  useThreadTimelineRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import { resolveThreadTimelinePlaceholder } from "./query-placeholders";
import {
  PROMPT_HISTORY_STALE_TIME_MS,
  requireThreadId,
  shouldRetryTransientReadQuery,
  TRANSIENT_READ_RETRY_DELAY_MS,
} from "./query-helpers";
import {
  HEAVY_PAYLOAD_QUERY_POLICY,
  REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  RESUME_REFETCH_QUERY_POLICY,
} from "./query-policies";
import {
  threadQueuedMessagesQueryKey,
  threadPromptHistoryQueryKey,
  threadStorageFilesQueryKey,
  threadStorageLocationQueryKey,
  threadStoragePathsQueryKey,
  threadStorageFilePreviewQueryKey,
  threadHostFilePreviewQueryKey,
  threadConversationOutlineQueryKey,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
  type ThreadConversationOutlineRole,
  type ThreadTimelineTurnSummaryDetailsQueryIdentity,
} from "./query-keys";
import {
  COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT,
  isThreadTimelinePushEnabled,
} from "../cache-owners/thread-timeline-push-owner";
import { systemConfigQueryOptions } from "./system-queries";
import {
  THREAD_OPEN_CACHE_GC_MS,
  touchThreadOpenCache,
} from "../cache-owners/thread-open-cache-owner";

import { fetchThreadTimeline, type QueryOptions } from "./thread-queries";
interface ThreadTimelineQueryOptions extends QueryOptions {
  notifyOnChangeProps?: NotifyOnChangeProps;
}

type ThreadConversationOutlineQueryOptions = QueryOptions;

type ThreadTimelineTurnSummaryDetailsQueryOptions = QueryOptions;

type ThreadQueuedMessagesQueryOptions = QueryOptions;

type ThreadPromptHistoryQueryOptions = QueryOptions;

export function threadQueuedMessagesQueryOptions(
  id: string,
  options?: ThreadQueuedMessagesQueryOptions,
) {
  return queryOptions<ThreadQueuedMessageListResponse>({
    queryKey: threadQueuedMessagesQueryKey(id),
    queryFn: ({ signal }) =>
      sdk.threads.queuedMessages.list({
        threadId: requireThreadId(id, "useThreadQueuedMessages"),
        signal,
      }),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount:
      options?.refetchOnMount ?? ((query) => query.getObserversCount() === 1),
    refetchOnWindowFocus: true,
    staleTime: options?.staleTime,
  });
}

export function useThreadQueuedMessages(
  id: string,
  options?: ThreadQueuedMessagesQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });
  return useQuery(threadQueuedMessagesQueryOptions(id, options));
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
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  });
}

export function threadStorageLocationQueryOptions(
  id: string,
  options?: QueryOptions,
) {
  return queryOptions<ThreadStorageLocationResponse>({
    queryKey: threadStorageLocationQueryKey(id),
    queryFn: ({ signal }) =>
      sdk.threads.storageLocation({
        threadId: requireThreadId(id, "useThreadStorageLocation"),
        signal,
      }),
    enabled: (options?.enabled ?? true) && Boolean(id),
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  });
}

export function useThreadStorageLocation(id: string, options?: QueryOptions) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });
  return useQuery(threadStorageLocationQueryOptions(id, options));
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

function isThreadHostFilePreviewEnabled(
  id: string,
  environmentId: string | null | undefined,
  path: string | null,
  options?: QueryOptions,
): boolean {
  return (
    (options?.enabled ?? true) &&
    Boolean(id) &&
    Boolean(environmentId) &&
    Boolean(path)
  );
}

export function threadHostFilePreviewQueryOptions(
  id: string,
  environmentId: string | null | undefined,
  path: string | null,
  options?: QueryOptions,
) {
  return queryOptions<FilePreview>({
    queryKey: threadHostFilePreviewQueryKey(id, environmentId, path),
    queryFn: ({ signal }) =>
      api.getThreadHostFilePreview(
        requireThreadId(id, "useThreadHostFilePreview"),
        path ?? "",
        signal,
      ),
    enabled: isThreadHostFilePreviewEnabled(id, environmentId, path, options),
    ...RESUME_REFETCH_QUERY_POLICY,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}

export function useThreadHostFilePreview(
  id: string,
  environmentId: string | null | undefined,
  path: string | null,
  options?: QueryOptions,
) {
  useThreadDetailRealtimeSubscription(id, {
    enabled: isThreadHostFilePreviewEnabled(id, environmentId, path, options),
  });
  return useQuery(
    threadHostFilePreviewQueryOptions(id, environmentId, path, options),
  );
}

export function threadTimelineQueryOptions(
  queryClient: QueryClient,
  id: string,
  options?: ThreadTimelineQueryOptions,
) {
  return queryOptions<ThreadTimelineResponse>({
    queryKey: threadTimelineQueryKey(id),
    queryFn: async ({ signal }) => {
      const threadId = requireThreadId(id, "useThreadTimeline");
      return fetchThreadTimeline({
        queryClient,
        signal,
        threadId,
      });
    },
    enabled: (options?.enabled ?? true) && Boolean(id),
    gcTime: THREAD_OPEN_CACHE_GC_MS,
    ...(options?.notifyOnChangeProps === undefined
      ? {}
      : { notifyOnChangeProps: options.notifyOnChangeProps }),
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

export function useThreadTimeline(
  id: string,
  options?: ThreadTimelineQueryOptions,
) {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(id);
  const compactViewport = useMediaQuery(COMPACT_VIEWPORT_QUERY);
  const pushEnabled = useQuery({
    ...systemConfigQueryOptions(),
    enabled: false,
    select: isThreadTimelinePushEnabled,
  }).data;
  useThreadDetailRealtimeSubscription(id, { enabled });
  useThreadTimelineRealtimeSubscription(id, {
    deferContent: true,
    enabled: enabled && pushEnabled === true,
    segmentLimit: compactViewport
      ? COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT
      : null,
  });
  useEffect(() => {
    if (enabled) {
      touchThreadOpenCache(queryClient, id);
    }
  }, [enabled, id, queryClient]);
  return useQuery(threadTimelineQueryOptions(queryClient, id, options));
}

export function useThreadConversationOutline(
  id: string,
  role: ThreadConversationOutlineRole,
  options?: ThreadConversationOutlineQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ThreadConversationOutlineResponse>({
    queryKey: threadConversationOutlineQueryKey(id, role),
    queryFn: async ({ signal }) => {
      const threadId = requireThreadId(id, "useThreadConversationOutline");
      return sdk.threads.conversationOutline({ threadId, role, signal });
    },
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    ...(options?.staleTime === undefined
      ? {}
      : { staleTime: options.staleTime }),
  });
}

function mergeTimelineTurnSummaryDetailsPages(
  data: InfiniteData<TimelineTurnSummaryDetailsResponse, string | undefined>,
): TimelineRow[] {
  const [latest, ...olderPages] = data.pages;
  let rows = latest?.rows ?? [];
  for (const older of olderPages) {
    rows = prependOlderTimelineRows({
      olderRows: older.rows,
      loadedRows: rows,
    });
  }
  return rows;
}

function threadTimelineTurnSummaryDetailsQueryOptions(
  identity: ThreadTimelineTurnSummaryDetailsQueryIdentity,
) {
  return infiniteQueryOptions<
    TimelineTurnSummaryDetailsResponse,
    Error,
    TimelineRow[],
    ReturnType<typeof threadTimelineTurnSummaryDetailsQueryKey>,
    string | undefined
  >({
    queryKey: threadTimelineTurnSummaryDetailsQueryKey(identity),
    queryFn: ({ pageParam, signal }) =>
      sdk.threads.timelineTurnSummaryDetails({
        threadId: requireThreadId(
          identity.threadId,
          "useThreadTimelineTurnSummaryDetails",
        ),
        sourceSeqEnd: String(identity.sourceSeqEnd),
        sourceSeqStart: String(identity.sourceSeqStart),
        turnId: identity.turnId,
        deferContent: "true",
        ...(identity.itemId === null ? {} : { itemId: identity.itemId }),
        ...(pageParam === undefined ? {} : { beforeCursor: pageParam }),
        signal,
      }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.olderCursor ?? undefined,
    select: mergeTimelineTurnSummaryDetailsPages,
    meta: {
      errorMessage: "Failed to load turn summary details.",
      showErrorToast: false,
    },
    staleTime: Infinity,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}

export function prefetchThreadTimelineTurnSummaryDetails(
  queryClient: QueryClient,
  identity: ThreadTimelineTurnSummaryDetailsQueryIdentity,
): void {
  if (!identity.threadId || !identity.turnId) {
    return;
  }
  void queryClient.prefetchInfiniteQuery(
    threadTimelineTurnSummaryDetailsQueryOptions(identity),
  );
}

export function useThreadTimelineTurnSummaryDetails(
  identity: ThreadTimelineTurnSummaryDetailsQueryIdentity,
  options?: ThreadTimelineTurnSummaryDetailsQueryOptions,
) {
  return useInfiniteQuery({
    ...threadTimelineTurnSummaryDetailsQueryOptions(identity),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(identity.threadId) &&
      Boolean(identity.turnId),
    refetchOnMount: options?.refetchOnMount ?? true,
    staleTime: options?.staleTime ?? Infinity,
  });
}
