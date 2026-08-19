/**
 * Declarative map from realtime change kinds to the query state they dirty.
 *
 * This module IS the "change kind → query keys" table. The realtime protocol
 * delivers coarse `ChangedMessage`s (entity + change kinds + optional metadata);
 * each `REALTIME_*_CHANGE_REGISTRY` entry lists the dirty handlers that turn one
 * change kind into the precise set of queries to invalidate. New change kinds
 * are added here, in one place, and the `satisfies *Registry` constraints force
 * mapped kinds to use the right context shape (verified by
 * `realtime-cache-effects.test.ts`).
 *
 * Why this isn't a flat `invalidateQueries(prefix)` table:
 * - Scoping uses notification metadata, not just the change kind. Thread changes
 *   carry `projectId`, `eventTypes`, and `hasPendingInteraction` so we invalidate
 *   only the affected project's lists, only refresh prompt history when an
 *   appended batch actually contained a turn request, and patch the sidebar
 *   pending-interaction badge from metadata instead of refetching.
 * - Some handlers do surgical `setQueryData` rather than invalidation
 *   (`patchThreadListPendingInteractionState`) or mark queries stale without an
 *   active refetch (`mark*Stale` for read-state changes), which a uniform
 *   invalidate-by-prefix table cannot express.
 * - Some handlers enumerate the live cache to find the exact keys to touch
 *   (cached thread lists for an environment, ref-derived diff/work-status keys),
 *   avoiding broad prefix invalidation of unrelated queries.
 * - The `flush` priority ("immediate" for `status-changed`, "debounced" for the
 *   rest) is consumed by `realtime-cache-effects.ts`, which batches thread
 *   invalidations to absorb the event storm of an active agent turn while still
 *   flushing status changes instantly so controls/banners react without lag.
 *
 * Handlers run through `executeRealtimeDirtyHandlers`; a handler returns query
 * keys to invalidate, or performs its own cache write and returns `void`. Raw
 * cache writes live exclusively in `cache-owners/` (enforced by
 * `cache-owner-registry.test.ts`), so this registry and the per-owner helpers
 * are the single sanctioned path between the realtime protocol and query state.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type {
  EnvironmentChangeKind,
  HostChangeKind,
  ProjectChangeKind,
  SystemChangeKind,
  ThreadChangeKind,
  ThreadEventType,
  ThreadWithRuntime,
} from "@bb/domain";
import {
  getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys,
  getCachedGlobalThreadListInvalidationQueryKeys,
  getCachedProjectThreadListInvalidationQueryKeys,
  getCachedRootOrderThreadListInvalidationQueryKeys,
  getCachedSidebarNavigationThreads,
  getCachedThreadListPlaceholder,
  getCachedThreadListQueryKeys,
  getEnvironmentBranchListInvalidationQueryKeys,
  getEnvironmentRecordInvalidationQueryKeys,
  getEnvironmentWorkspaceStateInvalidationQueryKeys,
  isArchivedThreadListQueryKey,
  removeEnvironmentDiffPatchQueries,
  updateCachedThreadListPendingInteractionState,
} from "./query-cache";
import {
  getCachedThreadLists,
  iterateThreadListCacheEntries,
} from "./thread-list-cache-data";
import {
  allHostQueryKeyPrefix,
  allPluginCatalogSearchQueryKeyPrefix,
  allPluginContributionsQueryKeyPrefix,
  allPluginListQueryKeyPrefix,
  allPluginSettingsQueryKeyPrefix,
  allPluginSettingsViewQueryKeyPrefix,
  allPluginSourceQueryKeyPrefix,
  allProjectCommandsQueryKeyPrefix,
  allThreadStorageFilePreviewQueryKeyPrefix,
  allThreadStorageFilesQueryKeyPrefix,
  allThreadStoragePathsQueryKeyPrefix,
  allSystemExecutionOptionsQueryKeyPrefix,
  allThreadQueryKeyPrefix,
  allTerminalsQueryKeyPrefix,
  environmentDiffFilesQueryKeyPrefix,
  environmentFilePreviewQueryKeyPrefix,
  environmentPullRequestQueryKey,
  environmentWorkStatusQueryKeyPrefix,
  hostsQueryKey,
  sidebarNavigationQueryKey,
  systemConfigQueryKey,
  allSystemProvidersQueryKeyPrefix,
  threadDefaultExecutionOptionsQueryKey,
  threadQueryKey,
  threadTabsQueryKey,
  threadSearchQueryKeyPrefix,
  terminalsQueryKey,
  threadsQueryKey,
  threadStorageFilePreviewQueryKeyPrefix,
  threadStorageFilesForThreadQueryKeyPrefix,
  threadStoragePathsForThreadQueryKeyPrefix,
  threadTimelineQueryKeyPrefix,
} from "../queries/query-keys";
import { schedulePluginFrontendReconcile } from "../../lib/plugin-frontend-lazy";
import {
  getProjectListInvalidationQueryKeys,
  getProjectPromptHistoryInvalidationQueryKeys,
  getProjectSourceDependentInvalidationQueryKeys,
  getThreadDetailInvalidationQueryKeys,
  getThreadListInvalidationQueryKeys,
  getThreadPendingInteractionInvalidationQueryKeys,
  getThreadPromptHistoryInvalidationQueryKeys,
  getThreadQueueContentInvalidationQueryKeys,
  getThreadTimelineInvalidationQueryKeys,
  getThreadTimelineWindowInvalidationQueryKeys,
} from "./cache-invalidation-groups";

interface CollectCachedThreadIdsForEnvironmentArgs {
  environmentId: string;
  queryClient: QueryClient;
}

interface TimelineInvalidationQueryKeysArgs {
  queryClient: QueryClient;
  queryKeys: readonly QueryKey[];
}

interface ScheduleTrailingActiveRefetchArgs {
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
  minIntervalMs: number;
  queryClient: QueryClient;
  queryKey: QueryKey;
}

/**
 * `work-status-changed` arrives on every file-change burst while an agent
 * edits. Each active work-status refetch is a `git status` probe on the host,
 * and the default invalidation aborts the probe already in flight. Compact
 * clients render the tally/branch from this query, so it must stay live —
 * but one probe per second is enough. Changes inside the interval coalesce
 * into a single trailing refetch, and an in-flight probe is never cancelled.
 */
const WORK_STATUS_REFETCH_MIN_INTERVAL_MS = 1_000;

/**
 * The trailing refetch is self-clocking: it fires as soon as the in-flight
 * fetch settles and any event arrived meanwhile. During a streaming turn events
 * always arrive, so with no floor the client requests a rebuild the instant the
 * previous one lands — a 100% duty cycle on a server-side projection that is
 * synchronous and blocks the server's event loop for everyone.
 *
 * Waiting out the observed build cost caps that duty cycle near 50%, which
 * leaves the loop time to serve the daemon endpoints the agent awaits between
 * tool calls. Fast threads are unaffected: their builds land in single-digit
 * milliseconds, so the floor collapses to the minimum.
 */
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
): boolean {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey, type: "active" })
    .some((query) => query.state.fetchStatus !== "idle");
}

function hasActiveQueries(
  queryClient: QueryClient,
  queryKey: QueryKey,
): boolean {
  return (
    queryClient.getQueryCache().findAll({ queryKey, type: "active" }).length >
    0
  );
}

function refetchActiveQueriesWithoutCanceling({
  queryClient,
  queryKey,
}: ScheduleTrailingActiveRefetchArgs): void {
  const hadActiveFetch = hasActiveFetchingQueries(queryClient, queryKey);
  void queryClient
    .refetchQueries({ queryKey, type: "active" }, { cancelRefetch: false })
    .catch(() => {
      // Individual query state already captures the refetch error.
    });
  if (hadActiveFetch) {
    // A change that raced the in-flight read must not be lost.
    scheduleTrailingActiveRefetch({ queryClient, queryKey });
  }
}

/**
 * Marks matching queries stale immediately (so a remount refetches) and
 * refetches the active ones at most once per `minIntervalMs`: the first change
 * after a quiet period refetches right away, later changes inside the interval
 * coalesce into one trailing refetch. Never cancels an in-flight fetch.
 */
function invalidateQueryKeyWithThrottledActiveRefetch({
  minIntervalMs,
  queryClient,
  queryKey,
}: ThrottledActiveRefetchArgs): void {
  queryClient.invalidateQueries({ queryKey, refetchType: "none" });

  const scheduleKey = timelineInvalidationKey(queryKey);
  let entries = throttledActiveRefetchEntries.get(queryClient);
  if (!entries) {
    entries = new Map();
    throttledActiveRefetchEntries.set(queryClient, entries);
  }
  const entry = entries.get(scheduleKey);
  if (entry?.timer) {
    // A trailing refetch is already pending; this change rides along.
    return;
  }
  const run = () => {
    entries.set(scheduleKey, { lastRunAt: Date.now(), timer: null });
    refetchActiveQueriesWithoutCanceling({ queryClient, queryKey });
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

  // Measured within this cycle only: from now (a fetch is already in flight —
  // that is why we were scheduled) until it settles. Deliberately NOT measured
  // across cycles, which would fold the previous delay into the next duration
  // and grow the interval geometrically.
  const waitingSince = Date.now();

  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (hasActiveFetchingQueries(queryClient, queryKey)) {
      return;
    }

    unsubscribe();
    unsubscribers.delete(scheduleKey);
    const delayMs = resolveTrailingRefetchDelayMs(Date.now() - waitingSince);
    const timer = setTimeout(() => {
      unsubscribers.delete(scheduleKey);
      void queryClient
        .refetchQueries({ queryKey, type: "active" }, { cancelRefetch: false })
        .catch(() => {
          // Individual query state already captures the refetch error.
        });
    }, delayMs);
    // Replace the (already-called) unsubscriber with a timer canceller so
    // disposal cannot refetch into a torn-down client.
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
    const hadActiveFetch = hasActiveFetchingQueries(queryClient, queryKey);
    // Avoid aborting the active timeline request on every event batch, but keep
    // one trailing refetch so an event that raced the in-flight read is not lost.
    queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    if (hadActiveFetch) {
      scheduleTrailingActiveRefetch({ queryClient, queryKey });
    }
  }
}

function invalidateTerminalTimelineQueryKeys({
  queryClient,
  queryKeys,
}: TimelineInvalidationQueryKeysArgs): void {
  for (const queryKey of queryKeys) {
    // A terminal event changes the latest window from an in-turn projection to
    // the canonical completed-turn projection. Letting an older read land after
    // that boundary briefly restores the streaming shape before the paced
    // trailing refetch corrects it. Completion is rare and authoritative, so
    // cancel the stale read and fetch the terminal shape immediately.
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
      dirtyThreadListQueries, // New thread can appear in project lists.
      dirtyThreadDetailQueries, // Detail may already be mounted after optimistic create/navigation.
      dirtyThreadTimelineQueries, // Creation can seed initial timeline rows.
      dirtyProjectPromptHistoryQueries, // Project thread changes can hide or reveal stored prompt history.
    ],
  },
  "thread-deleted": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueries, // Deleted thread must disappear from lists.
      dirtyThreadDetailQueries, // Active detail should reconcile to deleted/not-found.
      dirtyThreadTimelineQueries, // Active timeline should stop showing stale rows.
      dirtyProjectPromptHistoryQueries, // Deleted prompts may leave project history.
    ],
  },
  "events-appended": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueriesForBackgroundActivity, // Sidebar rows render active workflow/background task state.
      dirtyThreadDetailQueriesForBackgroundActivity, // Detail indicator reads activeBackgroundAgentCount.
      dirtyThreadSearchQueriesForCompletedTurn, // Indexed conversation content may match a search query once the turn settles.
      dirtyThreadTimelineQueries, // Timeline rows are built from appended events.
      dirtyThreadPullRequestQueryForCompletedTurn, // A turn may create a remote PR without changing the workspace.
      dirtyThreadPromptHistoryQueriesForTurnRequests, // Follow-up recall is built from client turn requests.
    ],
  },
  "history-rewritten": {
    flush: "immediate",
    dirty: [
      dirtyThreadListQueries,
      dirtyThreadDetailQueries,
      dirtyThreadSearchQueries,
      dirtyThreadTimelineRewriteQueries,
      dirtyThreadQueueContentQueries,
      dirtyProjectPromptHistoryQueries,
      dirtyThreadPendingInteractionQueries,
    ],
  },
  "interactions-changed": {
    flush: "debounced",
    dirty: [
      dirtyThreadSearchQueries, // Result rows render pending-interaction state.
      dirtyThreadPendingInteractionQueries, // Composer reads the interaction list directly.
      patchThreadListPendingInteractionState, // Sidebar badge patches from notification metadata.
    ],
  },
  "status-changed": {
    flush: "immediate",
    dirty: [
      dirtyActiveThreadListQueries, // List rows render status/runtime badges; archived pages only go stale.
      dirtyThreadDetailQueries, // Detail controls and banners depend on status.
    ],
  },
  "title-changed": {
    flush: "debounced",
    dirty: [
      dirtyActiveThreadListQueries, // List rows render display title; archived pages only go stale.
      dirtyThreadDetailQueries, // Detail headers and breadcrumbs render display title.
    ],
  },
  "queue-changed": {
    flush: "debounced",
    dirty: [
      dirtyThreadQueueContentQueries, // Composer queue and recall include queued messages.
    ],
  },
  "archived-changed": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueries, // Archive state moves threads between active/archived lists.
      dirtyThreadDetailQueries, // Detail controls and banners depend on archive state.
      dirtyProjectPromptHistoryQueries, // Archived prompts may leave project history.
    ],
  },
  "pin-state-changed": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueries, // Pinned state and pin order change sidebar/list ordering.
      dirtyThreadDetailQueries, // Detail consumers render the thread metadata contract.
    ],
  },
  "parent-changed": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueries, // Sidebar grouping and child filters depend on parentThreadId.
      dirtyThreadDetailQueries, // Detail metadata and parent UI render parentThreadId.
    ],
  },
  "environment-changed": {
    flush: "immediate",
    dirty: [
      dirtyActiveThreadListQueries, // Thread rows render environment/worktree metadata; archived pages only go stale.
      dirtyThreadDetailQueries, // Detail views use the attached environment for workspace UI.
      dirtyThreadDefaultExecutionOptionsQueries, // Environment changes can change inherited thread defaults.
      dirtyThreadStorageQueriesForThread, // Thread storage is resolved through the attached environment.
    ],
  },
  "read-state-changed": {
    flush: "debounced",
    dirty: [
      markThreadDetailQueryStale, // Keep active detail mounted; refresh on next read.
      markThreadListQueriesStale, // Unread badges should go stale without active refetch.
    ],
  },
  "order-changed": {
    flush: "debounced",
    dirty: [
      dirtyRootOrderThreadListQueries, // Root thread order affects root lists and global mention candidates.
    ],
  },
  "tabs-changed": {
    flush: "immediate",
    dirty: [dirtyThreadTabsQueries],
  },
  "terminals-changed": {
    flush: "debounced",
    dirty: [
      dirtyThreadTerminalQueries, // Terminal panel lists sessions by thread.
    ],
  },
} satisfies ThreadChangeRegistry;

export const REALTIME_ENVIRONMENT_CHANGE_REGISTRY = {
  "environment-created": {
    dirty: [
      dirtyEnvironmentRecordQueries, // Newly persisted environment metadata.
      dirtyEnvironmentWorkspaceStateQueries, // Initial work status/diff/preview state may exist.
      dirtyEnvironmentBranchListQueries, // New environment can expose branch options.
    ],
  },
  "environment-deleted": {
    dirty: [
      dirtyEnvironmentRecordQueries, // Record should reconcile to deleted/not-found.
      dirtyEnvironmentWorkspaceStateQueries, // Work status/diff/preview data is no longer valid.
      dirtyEnvironmentBranchListQueries, // Branch options are scoped to the environment.
    ],
  },
  "metadata-changed": {
    dirty: [
      dirtyEnvironmentRecordQueries, // Branch/display metadata is rendered directly.
      dirtyEnvironmentWorkspaceStateQueries, // Metadata can change workspace-state request resolution.
      dirtyEnvironmentBranchListQueries, // Branch metadata can change merge-base options.
      dirtyEnvironmentThreadListQueries, // Sidebar/worktree rows project environment labels from thread lists.
      dirtyThreadSearchQueries, // Search rows cache thread list entries with environment labels.
    ],
  },
  "status-changed": {
    dirty: [
      dirtyEnvironmentRecordQueries, // Environment record renders current status.
      dirtyEnvironmentWorkspaceStateQueries, // Status affects availability of workspace state.
      dirtyEnvironmentBranchListQueries, // Status can affect branch option availability.
    ],
  },
  "work-status-changed": {
    dirty: [
      dirtyEnvironmentLiveWorkspaceStateQueries, // Refresh live workspace-derived views after file edits (PR state is remote and unaffected).
    ],
  },
  "git-refs-changed": {
    dirty: [
      dirtyEnvironmentRefDerivedWorkspaceStateQueries, // Only cached ref-derived workspace queries need refresh.
      dirtyEnvironmentBranchListQueries, // Refs can add/remove/rename branch options.
    ],
  },
  "thread-storage-changed": {
    dirty: [
      dirtyThreadStorageQueriesForEnvironment, // Storage file lists/previews use thread-scoped keys.
    ],
  },
} satisfies EnvironmentChangeRegistry;

export const REALTIME_PROJECT_CHANGE_REGISTRY = {
  "project-created": {
    dirty: [
      dirtyProjectListQueries, // Navigation and settings are backed by sidebar navigation/project caches.
    ],
  },
  "project-updated": {
    dirty: [
      dirtyProjectListQueries, // Name/settings fields are embedded in sidebar navigation/project caches.
    ],
  },
  "project-deleted": {
    dirty: [
      dirtyProjectListQueries, // Deleted projects must disappear from navigation/pickers.
    ],
  },
  "project-sources-changed": {
    dirty: [
      dirtyProjectSourceDependentQueries, // Project sources back settings, file mentions, and branch pickers.
    ],
  },
  "threads-changed": {
    dirty: [
      dirtyProjectListQueries, // Sidebar navigation includes thread membership per project.
      dirtyProjectPromptHistoryQueries, // Project thread changes can hide or reveal stored prompt history.
    ],
  },
  "project-order-changed": {
    dirty: [
      dirtyProjectListQueries, // Sidebar order depends on project ordering.
    ],
  },
} satisfies ProjectChangeRegistry;

const HOST_CONNECTION_DIRTY_HANDLERS = [
  dirtyHostAvailabilityQueries, // Host list/detail render connected/disconnected state.
  dirtyProjectListQueries, // Project source availability depends on host connectivity.
  dirtySystemProviderQueries, // Host-backed provider runtimes can appear/disappear.
  dirtySystemExecutionOptionQueries, // Execution options include host/provider availability.
] satisfies readonly RealtimeDirtyHandler<HostRealtimeDirtyContext>[];

export const REALTIME_HOST_CHANGE_REGISTRY = {
  "host-connected": {
    dirty: HOST_CONNECTION_DIRTY_HANDLERS,
  },
  "host-disconnected": {
    dirty: HOST_CONNECTION_DIRTY_HANDLERS,
  },
} satisfies HostChangeRegistry;

export const REALTIME_SYSTEM_CHANGE_REGISTRY = {
  "config-changed": {
    dirty: [
      dirtySystemConfigQueries, // Experiments gate UI surfaces; other windows re-read after a settings write.
      dirtyAllThreadTimelineQueries, // General settings can change whether diagnostic provider rows are projected.
      dirtySystemProviderQueries,
      dirtySystemExecutionOptionQueries,
    ],
  },
  // Plugin load/dispose/enable/disable/reload changes the host-rendered
  // contributions (thread actions, slash commands, mention providers), the
  // Settings plugin list/forms, and the per-plugin useSettings() values.
  // It also drives the live frontend-bundle reconcile (re-import changed
  // bundles, drop removed ones) — a side effect, not a query invalidation.
  "plugins-changed": {
    dirty: [
      dirtyPluginContributionQueries,
      dirtyProjectCommandCatalogQueries,
      dirtyPluginManagementQueries,
      reconcilePluginFrontendBundles,
    ],
  },
  "provider-registrations-changed": {
    dirty: [
      dirtySystemProviderQueries, // Provider plugins add/remove picker entries.
      dirtySystemExecutionOptionQueries, // Refresh changed or boot-time partial provider rosters.
    ],
  },
} satisfies SystemChangeRegistry;

export type ThreadChangeFlushPriority = "debounced" | "immediate";

export interface RealtimeDirtyContext {
  queryClient: QueryClient;
}

export interface ThreadRealtimeDirtyContext extends RealtimeDirtyContext {
  backgroundActivityChanged: boolean | undefined;
  eventTypes: readonly ThreadEventType[] | undefined;
  /**
   * `true` the first time a key is seen within the current flush of batched
   * thread changes, `false` afterwards. Handlers whose effect is global (not
   * thread-scoped) use it to run once per flush instead of once per thread.
   */
  flushOnce: (key: string) => boolean;
  hasPendingInteraction: boolean | undefined;
  projectId: string | undefined;
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

export interface EnvironmentRealtimeDirtyContext extends RealtimeDirtyContext {
  environmentId: string;
  getCachedThreadIdsForEnvironment: () => string[];
}

export interface ProjectRealtimeDirtyContext extends RealtimeDirtyContext {
  projectId: string | undefined;
}

export type HostRealtimeDirtyContext = RealtimeDirtyContext;

export type RealtimeDirtyHandler<Context extends RealtimeDirtyContext> = (
  context: Context,
) => readonly QueryKey[] | void;

export interface ExecuteRealtimeDirtyHandlersArgs<
  Context extends RealtimeDirtyContext,
> {
  context: Context;
  handlers: readonly RealtimeDirtyHandler<Context>[];
}

export interface ThreadChangeRule {
  dirty: readonly RealtimeDirtyHandler<ThreadRealtimeDirtyContext>[];
  flush: ThreadChangeFlushPriority;
}

export type ThreadChangeRegistry = Record<ThreadChangeKind, ThreadChangeRule>;

export interface EnvironmentChangeRule {
  dirty: readonly RealtimeDirtyHandler<EnvironmentRealtimeDirtyContext>[];
}

export type EnvironmentChangeRegistry = Record<
  EnvironmentChangeKind,
  EnvironmentChangeRule
>;

export interface ProjectChangeRule {
  dirty: readonly RealtimeDirtyHandler<ProjectRealtimeDirtyContext>[];
}

export type ProjectChangeRegistry = Record<
  ProjectChangeKind,
  ProjectChangeRule
>;

export interface HostChangeRule {
  dirty: readonly RealtimeDirtyHandler<HostRealtimeDirtyContext>[];
}

export type HostChangeRegistry = Record<HostChangeKind, HostChangeRule>;

export interface SystemChangeRule {
  dirty: readonly RealtimeDirtyHandler<RealtimeDirtyContext>[];
}

export type SystemChangeRegistry = Partial<
  Record<SystemChangeKind, SystemChangeRule>
>;

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

export function shouldFlushThreadChangesImmediately(
  changes: readonly ThreadChangeKind[],
): boolean {
  return changes.some(
    (change) => REALTIME_THREAD_CHANGE_REGISTRY[change].flush === "immediate",
  );
}

export function collectCachedThreadIdsForEnvironment({
  environmentId,
  queryClient,
}: CollectCachedThreadIdsForEnvironmentArgs): string[] {
  const threadIds = new Set<string>();
  for (const [, thread] of queryClient.getQueriesData<ThreadWithRuntime>({
    queryKey: allThreadQueryKeyPrefix(),
  })) {
    if (thread?.environmentId === environmentId) {
      threadIds.add(thread.id);
    }
  }
  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      if (thread.environmentId === environmentId) {
        threadIds.add(thread.id);
      }
    }
  }
  return Array.from(threadIds);
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

/**
 * Same scope as {@link dirtyThreadListQueries}, but archived list pages are
 * only marked stale (`refetchType: "none"`): a status/title/environment change
 * on one thread does not justify refetching every un-windowed archived page
 * that the settings screen holds open. They refresh on the next mount.
 */
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

function dirtyRootOrderThreadListQueries({
  projectId,
  queryClient,
}: ThreadRealtimeDirtyContext): void {
  queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  for (const queryKey of getCachedRootOrderThreadListInvalidationQueryKeys({
    projectId,
    queryClient,
  })) {
    queryClient.invalidateQueries({ exact: true, queryKey });
  }
  if (!projectId) return;
  for (const queryKey of getCachedRootOrderThreadListInvalidationQueryKeys({
    queryClient,
  })) {
    queryClient.invalidateQueries({ exact: true, queryKey });
  }
}

function dirtyThreadDetailQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return getThreadDetailInvalidationQueryKeys({ threadId });
}

function dirtyThreadDefaultExecutionOptionsQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return threadId ? [threadDefaultExecutionOptionsQueryKey(threadId)] : [];
}

function dirtyThreadTabsQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return threadId ? [threadTabsQueryKey(threadId)] : [];
}

function dirtyThreadSearchQueries(): QueryKey[] {
  return [threadSearchQueryKeyPrefix()];
}

/**
 * Every client's list subscription receives every streaming thread's
 * `events-appended` batches. Re-issuing (and, by default, aborting) the open
 * search request on each 50-100 ms flush can starve it forever on a slow link,
 * so search only goes stale when a turn completes, once per flush, and without
 * cancelling a request in flight. Thread list changes cover the rest.
 */
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
  queryClient.invalidateQueries(
    { queryKey: threadSearchQueryKeyPrefix() },
    { cancelRefetch: false },
  );
}

function dirtyThreadTimelineQueries({
  eventTypes,
  queryClient,
  threadId,
}: ThreadRealtimeDirtyContext): void {
  // Window only: completed turn-summary-details are immutable, so realtime
  // event batches must not refetch open detail panels (see helper docs).
  const queryKeys = getThreadTimelineWindowInvalidationQueryKeys({ threadId });
  if (
    threadId !== undefined &&
    !hasActiveQueries(queryClient, threadTimelineQueryKeyPrefix(threadId))
  ) {
    // Nobody is viewing this thread: mark the cached window stale so a remount
    // refetches, but skip the fetch pacing/cancel machinery. List
    // subscriptions deliver every streaming thread's batches to every client.
    for (const queryKey of queryKeys) {
      queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    }
    return;
  }
  if (eventTypes?.includes("turn/completed")) {
    invalidateTerminalTimelineQueryKeys({ queryClient, queryKeys });
    return;
  }
  invalidateQueryKeysWithoutCancelingActiveFetches({ queryClient, queryKeys });
}

function dirtyThreadTimelineRewriteQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return getThreadTimelineInvalidationQueryKeys({ threadId });
}

function dirtyThreadQueueContentQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return getThreadQueueContentInvalidationQueryKeys({ threadId });
}

function dirtyThreadPromptHistoryQueriesForTurnRequests({
  eventTypes,
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  if (!eventTypes?.includes("client/turn/requested")) {
    return [];
  }
  return getThreadPromptHistoryInvalidationQueryKeys({ threadId });
}

function dirtyThreadPullRequestQueryForCompletedTurn({
  eventTypes,
  queryClient,
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  if (!threadId || !eventTypes?.includes("turn/completed")) {
    return [];
  }
  const cachedThread =
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId)) ??
    getCachedThreadListPlaceholder(queryClient, threadId) ??
    getCachedSidebarNavigationThreads(queryClient).find(
      (thread) => thread.id === threadId,
    );
  const environmentId = cachedThread?.environmentId;
  return environmentId ? [environmentPullRequestQueryKey(environmentId)] : [];
}

function dirtyThreadPendingInteractionQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return getThreadPendingInteractionInvalidationQueryKeys({ threadId });
}

function dirtyThreadTerminalQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return threadId
    ? [terminalsQueryKey({ kind: "thread", threadId })]
    : [allTerminalsQueryKeyPrefix()];
}

function dirtyThreadStorageQueriesForThread({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  if (!threadId) {
    return [
      allThreadStorageFilesQueryKeyPrefix(),
      allThreadStoragePathsQueryKeyPrefix(),
      allThreadStorageFilePreviewQueryKeyPrefix(),
    ];
  }
  return [
    threadStorageFilesForThreadQueryKeyPrefix(threadId),
    threadStoragePathsForThreadQueryKeyPrefix(threadId),
    threadStorageFilePreviewQueryKeyPrefix(threadId),
  ];
}

function dirtyProjectPromptHistoryQueries({
  projectId,
}: ProjectRealtimeDirtyContext | ThreadRealtimeDirtyContext): QueryKey[] {
  return getProjectPromptHistoryInvalidationQueryKeys({ projectId });
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

function markThreadListQueriesStale({
  projectId,
  queryClient,
}: ThreadRealtimeDirtyContext): void {
  queryClient.invalidateQueries({
    queryKey: sidebarNavigationQueryKey(),
    refetchType: "none",
  });
  if (!projectId) {
    queryClient.invalidateQueries({
      queryKey: threadsQueryKey(),
      refetchType: "none",
    });
    return;
  }
  for (const queryKey of getCachedProjectThreadListInvalidationQueryKeys({
    projectId,
    queryClient,
  })) {
    queryClient.invalidateQueries({
      queryKey,
      refetchType: "none",
    });
  }
  for (const queryKey of getCachedGlobalThreadListInvalidationQueryKeys({
    queryClient,
  })) {
    queryClient.invalidateQueries({
      exact: true,
      queryKey,
      refetchType: "none",
    });
  }
}

function patchThreadListPendingInteractionState({
  hasPendingInteraction,
  queryClient,
  threadId,
}: ThreadRealtimeDirtyContext): void {
  if (!threadId || hasPendingInteraction === undefined) {
    return;
  }
  updateCachedThreadListPendingInteractionState(
    queryClient,
    threadId,
    hasPendingInteraction,
  );
}

function dirtyEnvironmentRecordQueries(
  context: EnvironmentRealtimeDirtyContext,
): QueryKey[] {
  return getEnvironmentRecordInvalidationQueryKeys(context);
}

function dirtyEnvironmentWorkspaceStateQueries(
  context: EnvironmentRealtimeDirtyContext,
): void {
  for (const queryKey of getEnvironmentWorkspaceStateInvalidationQueryKeys(
    context,
  )) {
    context.queryClient.invalidateQueries({ queryKey });
  }
  // The observer-less patch cache must be evicted, not invalidated.
  removeEnvironmentDiffPatchQueries(context);
}

function dirtyEnvironmentLiveWorkspaceStateQueries({
  environmentId,
  queryClient,
}: EnvironmentRealtimeDirtyContext): void {
  invalidateQueryKeyWithThrottledActiveRefetch({
    minIntervalMs: WORK_STATUS_REFETCH_MIN_INTERVAL_MS,
    queryClient,
    queryKey: environmentWorkStatusQueryKeyPrefix(environmentId),
  });
  // The pull request is remote state: a local file edit cannot change it, so
  // it is deliberately not refetched here (`turn/completed` and the pending
  // check poll cover it).
  queryClient.invalidateQueries({
    queryKey: environmentFilePreviewQueryKeyPrefix(environmentId),
  });
  queryClient.invalidateQueries({
    queryKey: environmentDiffFilesQueryKeyPrefix(environmentId),
  });
  // Evict (not invalidate) the observer-less per-file patch cache so a
  // content-only edit re-fetches fresh patches: `getQueryData` returning
  // undefined is what makes the panel re-request a visible path. The TOC
  // refetch above bumps `dataUpdatedAt`, which retriggers that re-request.
  removeEnvironmentDiffPatchQueries({ environmentId, queryClient });
}

function dirtyEnvironmentRefDerivedWorkspaceStateQueries({
  environmentId,
  queryClient,
}: EnvironmentRealtimeDirtyContext): void {
  for (const queryKey of getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys(
    queryClient,
    { environmentId },
  )) {
    queryClient.invalidateQueries({ queryKey });
  }
  // A moved merge base affects every ref-derived diff target; evict the
  // observer-less patch cache so the panel re-requests fresh patches.
  removeEnvironmentDiffPatchQueries({ environmentId, queryClient });
}

function dirtyEnvironmentBranchListQueries(
  context: EnvironmentRealtimeDirtyContext,
): QueryKey[] {
  return getEnvironmentBranchListInvalidationQueryKeys(context);
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

function dirtyThreadStorageQueriesForEnvironment({
  getCachedThreadIdsForEnvironment,
}: EnvironmentRealtimeDirtyContext): QueryKey[] {
  const queryKeys: QueryKey[] = [];
  for (const threadId of getCachedThreadIdsForEnvironment()) {
    queryKeys.push(threadStorageFilesForThreadQueryKeyPrefix(threadId));
    queryKeys.push(threadStoragePathsForThreadQueryKeyPrefix(threadId));
    queryKeys.push(threadStorageFilePreviewQueryKeyPrefix(threadId));
  }
  return queryKeys;
}

function dirtyProjectListQueries(): QueryKey[] {
  return getProjectListInvalidationQueryKeys();
}

function dirtyProjectSourceDependentQueries({
  projectId,
}: ProjectRealtimeDirtyContext): QueryKey[] {
  return getProjectSourceDependentInvalidationQueryKeys({ projectId });
}

function dirtyHostAvailabilityQueries(): QueryKey[] {
  return [hostsQueryKey(), allHostQueryKeyPrefix()];
}

function dirtySystemConfigQueries(): QueryKey[] {
  return [systemConfigQueryKey()];
}

function dirtyAllThreadTimelineQueries(): QueryKey[] {
  return getThreadTimelineInvalidationQueryKeys({ threadId: undefined });
}

function dirtySystemProviderQueries(): QueryKey[] {
  return [allSystemProvidersQueryKeyPrefix()];
}

function dirtySystemExecutionOptionQueries(): QueryKey[] {
  return [allSystemExecutionOptionsQueryKeyPrefix()];
}

function dirtyPluginContributionQueries(): QueryKey[] {
  return [allPluginContributionsQueryKeyPrefix()];
}

function dirtyProjectCommandCatalogQueries(): QueryKey[] {
  return [allProjectCommandsQueryKeyPrefix()];
}

function dirtyPluginManagementQueries(): QueryKey[] {
  return [
    allPluginListQueryKeyPrefix(),
    allPluginSettingsViewQueryKeyPrefix(),
    allPluginSettingsQueryKeyPrefix(),
    // Update/install operations change source detail and catalog search rows
    // (installed/compatible flags) alongside the list.
    allPluginSourceQueryKeyPrefix(),
    allPluginCatalogSearchQueryKeyPrefix(),
  ];
}

/**
 * Live frontend reload (plugin design §5.1): re-import changed plugin
 * bundles and replace their slot registrations wholesale. Debounced +
 * serialized inside plugin-frontend; touches the slot store, not the query
 * cache, hence the void return.
 */
function reconcilePluginFrontendBundles(): void {
  schedulePluginFrontendReconcile();
}
