import type { ResolvedThreadExecutionOptions } from "@bb/domain";
import type {
  ThreadListResponse,
  ThreadPendingInteractionsResponse,
  ThreadQueuedMessageListResponse,
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  shouldRetryTransientReadQuery,
  TRANSIENT_READ_RETRY_DELAY_MS,
} from "@/lib/query/query-client";
import {
  threadDefaultExecutionOptionsQueryKey,
  threadDetailBootstrapQueryKey,
  threadListQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueuedMessagesQueryKey,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
  type ThreadTimelineTurnSummaryDetailsQueryIdentity,
} from "@/lib/query/query-keys";
import { requireEnabledQueryArg } from "../shared/query-helpers";
import { SESSION_STATIC_QUERY_POLICY } from "../shared/query-policies";
import {
  useThreadDetailRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "../shared/use-realtime-subscription";
import { THREAD_LIST_STALE_TIME_MS } from "../threads/thread-queries";
import { ingestThreadDetailBootstrap } from "./thread-detail-cache";
import { fetchThreadTimelineWindow } from "./timeline-fetch";

export { getLatestPendingInteraction } from "./pending-interactions";

interface QueryOptions {
  enabled?: boolean;
}

/**
 * `GET /threads/:id?include=environment,host`: the thread shell plus the
 * environment and host it runs in. Seeds the live `useThread`, environment,
 * and host caches (see `ingestThreadDetailBootstrap`) and kicks off the
 * timeline read at the same time: serializing them adds a full round trip to
 * every cold open, which is very visible through bb connect. Static for the
 * session: a history rewrite is the only realtime change that invalidates it.
 */
export function useThreadDetailBootstrap(
  threadId: string,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(threadId);
  useThreadDetailRealtimeSubscription(threadId, { enabled });

  return useQuery<ThreadWithIncludesResponse>({
    queryKey: threadDetailBootstrapQueryKey(threadId),
    queryFn: async ({ signal }) => {
      const id = requireEnabledQueryArg({
        value: threadId,
        hookName: "useThreadDetailBootstrap",
        argName: "thread id",
      });
      void queryClient.prefetchQuery({
        queryKey: threadTimelineQueryKey(id),
        queryFn: ({ signal: timelineSignal }) =>
          fetchThreadTimelineWindow({
            fetchTimeline: (args) => sdk.threads.timeline(args),
            previous: queryClient.getQueryData<ThreadTimelineResponse>(
              threadTimelineQueryKey(id),
            ),
            signal: timelineSignal,
            threadId: id,
          }),
      });
      const thread = await sdk.threads.get({
        include: "environment,host",
        threadId: id,
        signal,
      });
      ingestThreadDetailBootstrap(queryClient, thread);
      return thread;
    },
    enabled,
    ...SESSION_STATIC_QUERY_POLICY,
    retry: shouldRetryTransientReadQuery,
    retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
  });
}

/**
 * The latest timeline window of a thread (`GET /threads/:id/timeline`).
 * Refetches ask for a delta against the cached window (`afterSequence`) and
 * apply it with `applyTimelineDelta`; the realtime bridge invalidates this
 * key on every `events-appended` through the paced, non-cancelling path
 * (`@/lib/query/timeline-refetch-pacing`). Older pages are loaded by
 * `useThreadTimelineController`, not cached here.
 */
export function useThreadTimeline(threadId: string, options?: QueryOptions) {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && Boolean(threadId);
  useThreadDetailRealtimeSubscription(threadId, { enabled });

  return useQuery<ThreadTimelineResponse>({
    queryKey: threadTimelineQueryKey(threadId),
    queryFn: ({ signal }) => {
      const id = requireEnabledQueryArg({
        value: threadId,
        hookName: "useThreadTimeline",
        argName: "thread id",
      });
      return fetchThreadTimelineWindow({
        fetchTimeline: (args) => sdk.threads.timeline(args),
        previous: queryClient.getQueryData<ThreadTimelineResponse>(
          threadTimelineQueryKey(id),
        ),
        signal,
        threadId: id,
      });
    },
    enabled,
    refetchOnMount: true,
    retry: shouldRetryTransientReadQuery,
    retryDelay: TRANSIENT_READ_RETRY_DELAY_MS,
    // Keep the previous window on screen across a thread-id change only when
    // it is the same thread (the key changes otherwise and we start blank).
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === threadId ? previousData : undefined,
  });
}

/** `GET /threads/:id/interactions` (approvals, questions, plugin forms). */
export function useThreadPendingInteractions(
  threadId: string,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && Boolean(threadId);
  useThreadDetailRealtimeSubscription(threadId, { enabled });

  return useQuery<ThreadPendingInteractionsResponse>({
    queryKey: threadPendingInteractionsQueryKey(threadId),
    queryFn: ({ signal }) =>
      sdk.threads.interactions.list({
        threadId: requireEnabledQueryArg({
          value: threadId,
          hookName: "useThreadPendingInteractions",
          argName: "thread id",
        }),
        signal,
      }),
    enabled,
    refetchOnMount: true,
    // Realtime `interactions-changed` owns freshness; a foreground return
    // already refetches everything through the reconnect invalidation.
    refetchOnWindowFocus: false,
  });
}

/**
 * `GET /threads/:id/default-execution-options`: the options the next turn
 * inherits (last accepted run, else project / provider defaults). `null`
 * when the server cannot resolve them yet (no provider). Invalidated after
 * a send / history rewrite and by the realtime `environment-changed` kind.
 */
export function useThreadDefaultExecutionOptions(
  threadId: string,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && Boolean(threadId);
  useThreadDetailRealtimeSubscription(threadId, { enabled });

  return useQuery<ResolvedThreadExecutionOptions | null>({
    queryKey: threadDefaultExecutionOptionsQueryKey(threadId),
    queryFn: ({ signal }) =>
      sdk.threads.defaultExecutionOptions({
        threadId: requireEnabledQueryArg({
          value: threadId,
          hookName: "useThreadDefaultExecutionOptions",
          argName: "thread id",
        }),
        signal,
      }),
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

/** `GET /threads/:id/queued-messages` (the queue list under the composer). */
export function useThreadQueuedMessages(
  threadId: string,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && Boolean(threadId);
  useThreadDetailRealtimeSubscription(threadId, { enabled });

  return useQuery<ThreadQueuedMessageListResponse>({
    queryKey: threadQueuedMessagesQueryKey(threadId),
    queryFn: ({ signal }) =>
      sdk.threads.queuedMessages.list({
        threadId: requireEnabledQueryArg({
          value: threadId,
          hookName: "useThreadQueuedMessages",
          argName: "thread id",
        }),
        signal,
      }),
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

/**
 * Lazy children of one completed-turn summary row
 * (`GET /threads/:id/timeline/turn-summary-details`). Immutable for the
 * identity (turn + source sequence span), so it never goes stale; a history
 * rewrite invalidates every window of the thread.
 */
export function useTimelineTurnSummaryDetails(
  identity: ThreadTimelineTurnSummaryDetailsQueryIdentity,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled =
    (options?.enabled ?? true) &&
    Boolean(identity.threadId) &&
    Boolean(identity.turnId);

  return useQuery<TimelineTurnSummaryDetailsResponse>({
    queryKey: threadTimelineTurnSummaryDetailsQueryKey(identity),
    queryFn: ({ signal }) =>
      sdk.threads.timelineTurnSummaryDetails({
        threadId: requireEnabledQueryArg({
          value: identity.threadId,
          hookName: "useTimelineTurnSummaryDetails",
          argName: "thread id",
        }),
        sourceSeqEnd: String(identity.sourceSeqEnd),
        sourceSeqStart: String(identity.sourceSeqStart),
        turnId: identity.turnId,
        signal,
      }),
    enabled,
    meta: {
      errorMessage: "Failed to load turn summary details.",
      showErrorToast: false,
    },
    refetchOnMount: true,
    staleTime: Infinity,
  });
}

/**
 * Live children of one parent across every project. A child may live in a
 * different project than its parent, so the list is keyed by parent only.
 */
export function useChildThreads(
  parentThreadId: string | undefined,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && Boolean(parentThreadId);
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<ThreadListResponse>({
    queryKey: threadListQueryKey({
      archived: false,
      parentThreadId: parentThreadId ?? "",
    }),
    queryFn: ({ signal }) =>
      sdk.threads.list({
        archived: false,
        parentThreadId: requireEnabledQueryArg({
          value: parentThreadId,
          hookName: "useChildThreads",
          argName: "parent thread id",
        }),
        signal,
      }),
    enabled,
    staleTime: THREAD_LIST_STALE_TIME_MS,
  });
}
