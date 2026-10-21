import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type {
  EnvironmentChangeKind,
  ProjectChangeKind,
  SystemChangeKind,
  ThreadChangeKind,
  ThreadEventType,
  ThreadStatusChangeMetadata,
  ThreadWithRuntime,
} from "@bb/domain";
import {
  getCachedGlobalThreadListInvalidationQueryKeys,
  getCachedProjectThreadListInvalidationQueryKeys,
  getCachedSidebarNavigationThreads,
  getCachedThreadListPlaceholder,
  getCachedThreadListQueryKeys,
  getFetchingThreadListQueryKeys,
  isArchivedThreadListQueryKey,
  updateCachedThreadListPendingInteractionState,
} from "./query-cache";

import { markThreadTimelineUnseenEvents } from "./thread-timeline-unseen-events";
import {
  getCachedThreadLists,
  iterateThreadListCacheEntries,
} from "./thread-list-cache-data";
import {
  environmentPullRequestQueryKey,
  sidebarNavigationQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadQueryKey,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
  threadTimelineQueryKeyPrefix,
} from "../queries/query-keys";

import { schedulePluginFrontendReconcile } from "../../lib/plugin-frontend-lazy";
import {
  getThreadConversationOutlineInvalidationQueryKeys,
  getThreadDetailInvalidationQueryKeys,
  getThreadListInvalidationQueryKeys,
  getThreadPendingInteractionInvalidationQueryKeys,
  getThreadPromptHistoryInvalidationQueryKeys,
  getThreadQueueContentInvalidationQueryKeys,
  getThreadTimelineInvalidationQueryKeys,
  getThreadCompactedHistoryInvalidationQueryKeys,
  getThreadTimelineWindowInvalidationQueryKeys,
} from "./cache-invalidation-groups";
import { isCachedThreadTimelinePushEnabled } from "./thread-timeline-push-owner";

interface TimelineInvalidationQueryKeysArgs {
  queryClient: QueryClient;
  queryKeys: readonly QueryKey[];
}

interface ScheduleTrailingActiveRefetchArgs {
  exact: boolean;
  queryClient: QueryClient;
  queryKey: QueryKey;
}

interface CancelTrailingActiveRefetchArgs {
  queryClient: QueryClient;
  queryKey: QueryKey;
}

const trailingActiveRefetchUnsubscribers = new WeakMap<
  QueryClient,
  Map<string, () => void>
>();

interface ThrottledActiveRefetchEntry {
  lastRunAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const throttledActiveRefetchEntries = new WeakMap<
  QueryClient,
  Map<string, ThrottledActiveRefetchEntry>
>();

interface ThrottledActiveRefetchArgs {
  exact: boolean;
  minIntervalMs: number;
  queryClient: QueryClient;
  queryKey: QueryKey;
}

const THREAD_LIST_STATUS_FALLBACK_REFETCH_MIN_INTERVAL_MS = 1_000;

const TRAILING_REFETCH_MIN_INTERVAL_MS = 50;
const TRAILING_REFETCH_MAX_INTERVAL_MS = 1_000;

export function resolveTrailingRefetchDelayMs(
  observedFetchDurationMs: number,
): number {
  return Math.min(
    TRAILING_REFETCH_MAX_INTERVAL_MS,
    Math.max(TRAILING_REFETCH_MIN_INTERVAL_MS, observedFetchDurationMs),
  );
}

function timelineInvalidationKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey);
}

function hasActiveFetchingQueries(
  queryClient: QueryClient,
  queryKey: QueryKey,
  exact: boolean,
): boolean {
  return queryClient
    .getQueryCache()
    .findAll({ exact, queryKey, type: "active" })
    .some((query) => query.state.fetchStatus !== "idle");
}

function hasActiveQueries(
  queryClient: QueryClient,
  queryKey: QueryKey,
): boolean {
  return (
    queryClient.getQueryCache().findAll({ queryKey, type: "active" }).length > 0
  );
}

function refetchActiveQueriesWithoutCanceling({
  exact,
  queryClient,
  queryKey,
}: ScheduleTrailingActiveRefetchArgs): void {
  const hadActiveFetch = hasActiveFetchingQueries(queryClient, queryKey, exact);
  void queryClient
    .refetchQueries(
      { exact, queryKey, type: "active" },
      { cancelRefetch: false },
    )
    .catch(() => {});
  if (hadActiveFetch) {
    scheduleTrailingActiveRefetch({ exact, queryClient, queryKey });
  }
}

function invalidateQueryKeyWithThrottledActiveRefetch({
  exact,
  minIntervalMs,
  queryClient,
  queryKey,
}: ThrottledActiveRefetchArgs): void {
  queryClient.invalidateQueries({ exact, queryKey, refetchType: "none" });

  const scheduleKey = timelineInvalidationKey(queryKey);
  let entries = throttledActiveRefetchEntries.get(queryClient);
  if (!entries) {
    entries = new Map();
    throttledActiveRefetchEntries.set(queryClient, entries);
  }
  const entry = entries.get(scheduleKey);
  if (entry?.timer) {
    return;
  }
  const run = () => {
    entries.set(scheduleKey, { lastRunAt: Date.now(), timer: null });
    refetchActiveQueriesWithoutCanceling({ exact, queryClient, queryKey });
  };
  const lastRunAt = entry?.lastRunAt ?? Number.NEGATIVE_INFINITY;
  const delayMs = Math.max(0, lastRunAt + minIntervalMs - Date.now());
  if (delayMs === 0) {
    run();
    return;
  }
  entries.set(scheduleKey, { lastRunAt, timer: setTimeout(run, delayMs) });
}

function scheduleTrailingActiveRefetch({
  exact,
  queryClient,
  queryKey,
}: ScheduleTrailingActiveRefetchArgs): void {
  const scheduleKey = timelineInvalidationKey(queryKey);
  let unsubscribers = trailingActiveRefetchUnsubscribers.get(queryClient);
  if (!unsubscribers) {
    unsubscribers = new Map();
    trailingActiveRefetchUnsubscribers.set(queryClient, unsubscribers);
  }
  if (unsubscribers.has(scheduleKey)) {
    return;
  }

  const waitingSince = Date.now();

  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (hasActiveFetchingQueries(queryClient, queryKey, exact)) {
      return;
    }

    unsubscribe();
    unsubscribers.delete(scheduleKey);
    const delayMs = resolveTrailingRefetchDelayMs(Date.now() - waitingSince);
    const timer = setTimeout(() => {
      unsubscribers.delete(scheduleKey);
      void queryClient
        .refetchQueries(
          { exact, queryKey, type: "active" },
          { cancelRefetch: false },
        )
        .catch(() => {});
    }, delayMs);
    unsubscribers.set(scheduleKey, () => {
      clearTimeout(timer);
    });
  });
  unsubscribers.set(scheduleKey, unsubscribe);
}

function cancelTrailingActiveRefetch({
  queryClient,
  queryKey,
}: CancelTrailingActiveRefetchArgs): void {
  const unsubscribers = trailingActiveRefetchUnsubscribers.get(queryClient);
  if (!unsubscribers) {
    return;
  }
  const scheduleKey = timelineInvalidationKey(queryKey);
  unsubscribers.get(scheduleKey)?.();
  unsubscribers.delete(scheduleKey);
  if (unsubscribers.size === 0) {
    trailingActiveRefetchUnsubscribers.delete(queryClient);
  }
}

function invalidateQueryKeysWithoutCancelingActiveFetches({
  queryClient,
  queryKeys,
}: TimelineInvalidationQueryKeysArgs): void {
  for (const queryKey of queryKeys) {
    const hadActiveFetch = hasActiveFetchingQueries(
      queryClient,
      queryKey,
      false,
    );
    queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    if (hadActiveFetch) {
      scheduleTrailingActiveRefetch({ exact: false, queryClient, queryKey });
    }
  }
}

function invalidateTerminalTimelineQueryKeys({
  queryClient,
  queryKeys,
}: TimelineInvalidationQueryKeysArgs): void {
  for (const queryKey of queryKeys) {
    cancelTrailingActiveRefetch({ queryClient, queryKey });
    void queryClient.cancelQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey });
  }
}

export function disposeTrailingActiveRefetches(queryClient: QueryClient): void {
  const throttled = throttledActiveRefetchEntries.get(queryClient);
  if (throttled) {
    for (const entry of throttled.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
    }
    throttledActiveRefetchEntries.delete(queryClient);
  }
  const unsubscribers = trailingActiveRefetchUnsubscribers.get(queryClient);
  if (!unsubscribers) {
    return;
  }
  for (const unsubscribe of unsubscribers.values()) {
    unsubscribe();
  }
  trailingActiveRefetchUnsubscribers.delete(queryClient);
}

export const REALTIME_THREAD_CHANGE_REGISTRY = {
  "thread-created": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueries,
      dirtyThreadDetailQueries,
      dirtyThreadTimelineQueries,
    ],
  },
  "thread-deleted": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueries,
      dirtyThreadDetailQueries,
      dirtyThreadTimelineQueries,
    ],
  },
  "events-appended": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueriesForBackgroundActivity,
      dirtyThreadDetailQueriesForBackgroundActivity,
      dirtyThreadSearchQueriesForCompletedTurn,
      dirtyThreadTimelineQueriesForAppendedEvents,
      dirtyThreadPullRequestQueryForCompletedTurn,
      dirtyThreadTurnRequestQueries,
    ],
  },
  "history-rewritten": {
    flush: "immediate",
    dirty: [
      dirtyThreadListQueries,
      dirtyThreadDetailQueries,
      dirtyThreadSearchQueries,
      getThreadTimelineInvalidationQueryKeys,
      getThreadQueueContentInvalidationQueryKeys,
      getThreadPendingInteractionInvalidationQueryKeys,
    ],
  },
  "history-compacted": {
    flush: "debounced",
    dirty: [getThreadCompactedHistoryInvalidationQueryKeys],
  },
  "interactions-changed": {
    flush: "debounced",
    patch: [patchThreadListPendingInteractionState],
    dirty: [
      dirtyThreadSearchQueries,
      getThreadPendingInteractionInvalidationQueryKeys,
    ],
  },
  "status-changed": {
    flush: "immediate",
    dirty: [refreshThreadListStatusState, dirtyThreadDetailQueries],
  },
  "title-changed": {
    flush: "debounced",
    dirty: [dirtyActiveThreadListQueries, dirtyThreadDetailQueries],
  },
  "queue-changed": {
    flush: "debounced",
    dirty: [
      getThreadQueueContentInvalidationQueryKeys,
      dirtyActiveThreadListQueries,
    ],
  },
  "archived-changed": {
    flush: "debounced",
    dirty: [dirtyThreadListQueries, dirtyThreadDetailQueries],
  },
  "pin-state-changed": {
    flush: "debounced",
    dirty: [dirtyThreadListQueries, dirtyThreadDetailQueries],
  },
  "parent-changed": {
    flush: "debounced",
    dirty: [dirtyThreadListQueries, dirtyThreadDetailQueries],
  },
  "environment-changed": {
    flush: "immediate",
    dirty: [dirtyActiveThreadListQueries, dirtyThreadDetailQueries],
  },
  "read-state-changed": {
    flush: "debounced",
    dirty: [markThreadDetailQueryStale, dirtyActiveThreadListQueries],
  },
  "tabs-changed": {
    flush: "immediate",
    dirty: [],
  },
  "terminals-changed": {
    flush: "debounced",
    dirty: [],
  },
} satisfies ThreadChangeRegistry;

export const REALTIME_ENVIRONMENT_CHANGE_REGISTRY: EnvironmentChangeRegistry = {
  "environment-created": {
    dirty: [],
  },
  "environment-deleted": {
    dirty: [],
  },
  "metadata-changed": {
    dirty: [dirtyEnvironmentThreadListQueries, dirtyThreadSearchQueries],
  },
  "status-changed": {
    dirty: [],
  },
  "work-status-changed": {
    dirty: [],
  },
  "git-refs-changed": {
    dirty: [],
  },
};

export const REALTIME_PROJECT_CHANGE_REGISTRY = {
  "project-created": {
    dirty: [dirtyProjectThreadViews],
  },
  "project-updated": {
    dirty: [dirtyProjectThreadViews],
  },
  "project-deleted": {
    dirty: [dirtyProjectThreadViews],
  },
  "project-sources-changed": {
    dirty: [dirtyProjectSourceThreadViews],
  },
  "threads-changed": {
    dirty: [dirtyProjectThreadViews],
  },
  "project-order-changed": {
    dirty: [dirtyProjectThreadViews],
  },
} satisfies ProjectChangeRegistry;

export const REALTIME_HOST_CHANGE_REGISTRY = {
  "host-connected": { dirty: [dirtyProjectThreadViews] },
  "host-disconnected": { dirty: [dirtyProjectThreadViews] },
  "provider-model-catalog-changed": { dirty: [] },
};

export const REALTIME_SYSTEM_CHANGE_REGISTRY: SystemChangeRegistry = {
  "config-changed": {
    dirty: [dirtyAllThreadTimelineQueries],
  },
  "plugins-changed": {
    dirty: [reconcilePluginFrontendBundles],
  },
};

type ThreadChangeFlushPriority = "debounced" | "immediate";

interface RealtimeDirtyContext {
  queryClient: QueryClient;
}

interface ThreadRealtimeDirtyContext extends RealtimeDirtyContext {
  backgroundActivityChanged: boolean | undefined;
  eventTypes: readonly ThreadEventType[] | undefined;
  timelineSequence: number | undefined;
  flushOnce: (key: string) => boolean;
  hasPendingInteraction: boolean | undefined;
  projectId: string | undefined;
  statusChange: ThreadStatusChangeMetadata | undefined;
  threadId: string | undefined;
}

export function createFlushOncePredicate(): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
}

interface EnvironmentRealtimeDirtyContext extends RealtimeDirtyContext {
  environmentId: string;
}

interface ProjectRealtimeDirtyContext extends RealtimeDirtyContext {
  projectId: string | undefined;
}

type RealtimeDirtyHandler<Context extends RealtimeDirtyContext> = (
  context: Context,
) => readonly QueryKey[] | void;

interface ExecuteRealtimeDirtyHandlersArgs<
  Context extends RealtimeDirtyContext,
> {
  context: Context;
  handlers: readonly RealtimeDirtyHandler<Context>[];
}

interface ThreadRealtimePatchContext {
  hasPendingInteraction: boolean | undefined;
  queryClient: QueryClient;
  statusChange: ThreadStatusChangeMetadata | undefined;
  threadId: string;
}

interface ThreadChangeRule {
  patch?: readonly ((context: ThreadRealtimePatchContext) => void)[];
  dirty: readonly RealtimeDirtyHandler<ThreadRealtimeDirtyContext>[];
  flush: ThreadChangeFlushPriority;
}

type ThreadChangeRegistry = Record<ThreadChangeKind, ThreadChangeRule>;

interface EnvironmentChangeRule {
  dirty: readonly RealtimeDirtyHandler<EnvironmentRealtimeDirtyContext>[];
}

type EnvironmentChangeRegistry = Partial<
  Record<EnvironmentChangeKind, EnvironmentChangeRule>
>;

interface ProjectChangeRule {
  dirty: readonly RealtimeDirtyHandler<ProjectRealtimeDirtyContext>[];
}

type ProjectChangeRegistry = Record<ProjectChangeKind, ProjectChangeRule>;

interface SystemChangeRule {
  dirty: readonly RealtimeDirtyHandler<RealtimeDirtyContext>[];
}

type SystemChangeRegistry = Partial<Record<SystemChangeKind, SystemChangeRule>>;

export function executeRealtimeDirtyHandlers<
  Context extends RealtimeDirtyContext,
>({ context, handlers }: ExecuteRealtimeDirtyHandlersArgs<Context>): void {
  for (const handler of handlers) {
    const queryKeys = handler(context);
    if (!queryKeys) {
      continue;
    }
    for (const queryKey of queryKeys) {
      context.queryClient.invalidateQueries({ queryKey });
    }
  }
}

export function applyRealtimeThreadPatches(
  changes: readonly ThreadChangeKind[],
  context: ThreadRealtimePatchContext,
): void {
  for (const changeKind of changes) {
    const rule: ThreadChangeRule = REALTIME_THREAD_CHANGE_REGISTRY[changeKind];
    for (const patch of rule.patch ?? []) {
      patch(context);
    }
  }
}

export interface ThreadChangesByFlushPriority {
  debounced: ThreadChangeKind[] | null;
  immediate: ThreadChangeKind[] | null;
}

export function partitionThreadChangesByFlushPriority(
  changes: readonly ThreadChangeKind[],
): ThreadChangesByFlushPriority {
  let debounced: ThreadChangeKind[] | null = null;
  let immediate: ThreadChangeKind[] | null = null;
  for (const change of changes) {
    if (REALTIME_THREAD_CHANGE_REGISTRY[change].flush === "immediate") {
      (immediate ??= []).push(change);
    } else {
      (debounced ??= []).push(change);
    }
  }
  return { debounced, immediate };
}

function dirtyThreadListQueries({
  projectId,
  queryClient,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  if (projectId) {
    for (const queryKey of getCachedGlobalThreadListInvalidationQueryKeys({
      queryClient,
    })) {
      queryClient.invalidateQueries({ exact: true, queryKey });
    }
  }
  return getThreadListInvalidationQueryKeys({ projectId, queryClient });
}

function dirtyActiveThreadListQueries({
  projectId,
  queryClient,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  const listQueryKeys = projectId
    ? [
        ...getCachedProjectThreadListInvalidationQueryKeys({
          projectId,
          queryClient,
        }),
        ...getCachedGlobalThreadListInvalidationQueryKeys({ queryClient }),
      ]
    : getCachedThreadListQueryKeys(queryClient);
  for (const queryKey of listQueryKeys) {
    queryClient.invalidateQueries({
      exact: true,
      queryKey,
      ...(isArchivedThreadListQueryKey(queryKey)
        ? { refetchType: "none" }
        : {}),
    });
  }
  return [sidebarNavigationQueryKey(), threadSearchQueryKeyPrefix()];
}

function dirtyActiveThreadListQueriesWithThrottledRefetch({
  projectId,
  queryClient,
}: ThreadRealtimeDirtyContext): void {
  const listQueryKeys = projectId
    ? [
        ...getCachedProjectThreadListInvalidationQueryKeys({
          projectId,
          queryClient,
        }),
        ...getCachedGlobalThreadListInvalidationQueryKeys({ queryClient }),
      ]
    : getCachedThreadListQueryKeys(queryClient);
  for (const queryKey of listQueryKeys) {
    if (isArchivedThreadListQueryKey(queryKey)) {
      queryClient.invalidateQueries({
        exact: true,
        queryKey,
        refetchType: "none",
      });
      continue;
    }
    invalidateQueryKeyWithThrottledActiveRefetch({
      exact: true,
      minIntervalMs: THREAD_LIST_STATUS_FALLBACK_REFETCH_MIN_INTERVAL_MS,
      queryClient,
      queryKey,
    });
  }
  for (const queryKey of [
    sidebarNavigationQueryKey(),
    threadSearchQueryKeyPrefix(),
  ]) {
    invalidateQueryKeyWithThrottledActiveRefetch({
      exact: false,
      minIntervalMs: THREAD_LIST_STATUS_FALLBACK_REFETCH_MIN_INTERVAL_MS,
      queryClient,
      queryKey,
    });
  }
}

function dirtyThreadListQueriesForBackgroundActivity(
  context: ThreadRealtimeDirtyContext,
): QueryKey[] {
  if (context.backgroundActivityChanged !== true) {
    return [];
  }
  return dirtyActiveThreadListQueries(context);
}

function dirtyThreadDetailQueriesForBackgroundActivity(
  context: ThreadRealtimeDirtyContext,
): QueryKey[] {
  if (context.backgroundActivityChanged !== true) {
    return [];
  }
  return dirtyThreadDetailQueries(context);
}

function dirtyThreadDetailQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return getThreadDetailInvalidationQueryKeys({ threadId });
}

function dirtyThreadSearchQueries(): QueryKey[] {
  return [threadSearchQueryKeyPrefix()];
}

function dirtyThreadSearchQueriesForCompletedTurn({
  eventTypes,
  flushOnce,
  queryClient,
}: ThreadRealtimeDirtyContext): void {
  if (!eventTypes?.includes("turn/completed")) {
    return;
  }
  if (!flushOnce("thread-search:turn-completed")) {
    return;
  }
  invalidateQueryKeysWithoutCancelingActiveFetches({
    queryClient,
    queryKeys: [threadSearchQueryKeyPrefix()],
  });
}

function dirtyThreadTimelineQueries({
  eventTypes,
  timelineSequence,
  queryClient,
  threadId,
}: ThreadRealtimeDirtyContext): void {
  const timelineQueryKeys = getThreadTimelineWindowInvalidationQueryKeys({
    threadId,
  });
  const outlineQueryKeys = getThreadConversationOutlineInvalidationQueryKeys({
    threadId,
  });
  const outlineMayHaveChanged =
    eventTypes === undefined || eventTypes.includes("turn/completed");
  if (threadId !== undefined && timelineSequence !== undefined) {
    markThreadTimelineUnseenEvents(queryClient, threadId, timelineSequence);
  }
  if (
    threadId !== undefined &&
    !hasActiveQueries(queryClient, threadTimelineQueryKeyPrefix(threadId))
  ) {
    for (const queryKey of [...timelineQueryKeys, ...outlineQueryKeys]) {
      queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    }
    return;
  }
  if (eventTypes?.includes("turn/completed")) {
    invalidateTerminalTimelineQueryKeys({
      queryClient,
      queryKeys: [...timelineQueryKeys, ...outlineQueryKeys],
    });
    return;
  }
  invalidateQueryKeysWithoutCancelingActiveFetches({
    queryClient,
    queryKeys: timelineQueryKeys,
  });
  if (outlineMayHaveChanged) {
    invalidateQueryKeysWithoutCancelingActiveFetches({
      queryClient,
      queryKeys: outlineQueryKeys,
    });
  }
}

function dirtyThreadTimelineQueriesForAppendedEvents(
  context: ThreadRealtimeDirtyContext,
): void {
  const { eventTypes, queryClient, threadId, timelineSequence } = context;
  if (
    threadId === undefined ||
    !isCachedThreadTimelinePushEnabled(queryClient) ||
    !hasActiveQueries(queryClient, threadTimelineQueryKeyPrefix(threadId))
  ) {
    dirtyThreadTimelineQueries(context);
    return;
  }
  if (timelineSequence !== undefined) {
    markThreadTimelineUnseenEvents(queryClient, threadId, timelineSequence);
  }
  const outlineQueryKeys = getThreadConversationOutlineInvalidationQueryKeys({
    threadId,
  });
  if (eventTypes === undefined) {
    invalidateQueryKeysWithoutCancelingActiveFetches({
      queryClient,
      queryKeys: outlineQueryKeys,
    });
  } else if (eventTypes.includes("turn/completed")) {
    invalidateTerminalTimelineQueryKeys({
      queryClient,
      queryKeys: outlineQueryKeys,
    });
  }
}

function dirtyThreadTurnRequestQueries({
  eventTypes,
  queryClient,
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  if (!threadId || !eventTypes?.includes("client/turn/requested")) return [];
  const queryKey = threadDefaultExecutionOptionsQueryKey(threadId);
  void queryClient.cancelQueries({ queryKey });
  return [
    queryKey,
    ...getThreadPromptHistoryInvalidationQueryKeys({ threadId }),
  ];
}

function dirtyThreadPullRequestQueryForCompletedTurn({
  eventTypes,
  queryClient,
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  if (!threadId || !eventTypes?.includes("turn/completed")) {
    return [];
  }
  const environmentId = getCachedThreadEnvironmentId({ queryClient, threadId });
  return environmentId ? [environmentPullRequestQueryKey(environmentId)] : [];
}

export function getCachedThreadEnvironmentId({
  queryClient,
  threadId,
}: {
  queryClient: QueryClient;
  threadId: string;
}): string | null {
  const cachedThread =
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId)) ??
    getCachedThreadListPlaceholder(queryClient, threadId) ??
    getCachedSidebarNavigationThreads(queryClient).find(
      (thread) => thread.id === threadId,
    );
  return cachedThread?.environmentId ?? null;
}

function markThreadDetailQueryStale({
  queryClient,
  threadId,
}: ThreadRealtimeDirtyContext): void {
  if (!threadId) {
    return;
  }
  queryClient.invalidateQueries({
    queryKey: threadQueryKey(threadId),
    refetchType: "none",
  });
}

function patchThreadListPendingInteractionState({
  hasPendingInteraction,
  queryClient,
  threadId,
}: ThreadRealtimePatchContext): void {
  if (hasPendingInteraction === undefined) {
    return;
  }
  updateCachedThreadListPendingInteractionState(
    queryClient,
    threadId,
    hasPendingInteraction,
  );
}

function refreshThreadListStatusState(
  context: ThreadRealtimeDirtyContext,
): void {
  const { flushOnce, queryClient, statusChange, threadId } = context;
  if (!threadId || !statusChange) {
    dirtyActiveThreadListQueriesWithThrottledRefetch(context);
    return;
  }
  for (const queryKey of getFetchingThreadListQueryKeys(queryClient)) {
    queryClient.invalidateQueries({ exact: true, queryKey });
  }
  if (flushOnce("thread-search:status-changed")) {
    invalidateQueryKeysWithoutCancelingActiveFetches({
      queryClient,
      queryKeys: [threadSearchQueryKeyPrefix()],
    });
  }
}

function dirtyEnvironmentThreadListQueries({
  environmentId,
  queryClient,
}: EnvironmentRealtimeDirtyContext): QueryKey[] {
  const queryKeys: QueryKey[] = [];
  for (const { data, queryKey } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      if (thread.environmentId !== environmentId) {
        continue;
      }
      queryKeys.push(queryKey);
      break;
    }
  }

  const sidebarContainsEnvironment = getCachedSidebarNavigationThreads(
    queryClient,
  ).some((thread) => thread.environmentId === environmentId);
  if (sidebarContainsEnvironment) {
    queryKeys.push(sidebarNavigationQueryKey());
  }

  return queryKeys;
}

function dirtyAllThreadTimelineQueries(): QueryKey[] {
  return getThreadTimelineInvalidationQueryKeys({ threadId: undefined });
}

function reconcilePluginFrontendBundles(): void {
  schedulePluginFrontendReconcile();
}

function dirtyProjectThreadViews(): QueryKey[] {
  return [sidebarNavigationQueryKey(), threadSearchQueryKeyPrefix()];
}
function dirtyProjectSourceThreadViews(): QueryKey[] {
  return [sidebarNavigationQueryKey()];
}
