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
  getEnvironmentBranchListInvalidationQueryKeys,
  getEnvironmentRecordInvalidationQueryKeys,
  getEnvironmentWorkspaceStateInvalidationQueryKeys,
  removeEnvironmentDiffPatchQueries,
  updateCachedThreadListPendingInteractionState,
} from "./query-cache";
import {
  getCachedThreadLists,
  iterateThreadListCacheEntries,
} from "./thread-list-cache-data";
import {
  allHostQueryKeyPrefix,
  allAutomationDetailQueryKeyPrefix,
  allAutomationRunsQueryKeyPrefix,
  automationsQueryKey,
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
  systemProvidersQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadQueryKey,
  threadSearchQueryKeyPrefix,
  terminalsQueryKey,
  threadsQueryKey,
  threadStorageFilePreviewQueryKeyPrefix,
  threadStorageFilesForThreadQueryKeyPrefix,
  threadStoragePathsForThreadQueryKeyPrefix,
} from "../queries/query-keys";
import { uiSourceStatusQueryKey } from "../queries/ui-source-queries";
import {
  getProjectListInvalidationQueryKeys,
  getProjectPromptHistoryInvalidationQueryKeys,
  getProjectSourceDependentInvalidationQueryKeys,
  getThreadDetailInvalidationQueryKeys,
  getThreadListInvalidationQueryKeys,
  getThreadPendingInteractionInvalidationQueryKeys,
  getThreadPromptHistoryInvalidationQueryKeys,
  getThreadQueueContentInvalidationQueryKeys,
  getThreadTimelineWindowInvalidationQueryKeys,
} from "./cache-invalidation-groups";

interface CollectCachedThreadIdsForEnvironmentArgs {
  environmentId: string;
  queryClient: QueryClient;
}

interface InvalidateQueryKeysWithoutCancelingActiveFetchesArgs {
  queryClient: QueryClient;
  queryKeys: readonly QueryKey[];
}

interface ScheduleTrailingActiveRefetchArgs {
  queryClient: QueryClient;
  queryKey: QueryKey;
}

const trailingActiveRefetchUnsubscribers = new WeakMap<
  QueryClient,
  Map<string, () => void>
>();

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

  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (hasActiveFetchingQueries(queryClient, queryKey)) {
      return;
    }

    unsubscribe();
    unsubscribers.delete(scheduleKey);
    void queryClient
      .refetchQueries({ queryKey, type: "active" }, { cancelRefetch: false })
      .catch(() => {
        // Individual query state already captures the refetch error.
      });
  });
  unsubscribers.set(scheduleKey, unsubscribe);
}

function invalidateQueryKeysWithoutCancelingActiveFetches({
  queryClient,
  queryKeys,
}: InvalidateQueryKeysWithoutCancelingActiveFetchesArgs): void {
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

export function disposeTrailingActiveRefetches(queryClient: QueryClient): void {
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
      dirtyAutomationQueries, // Automation rows reference the spawning thread.
    ],
  },
  "events-appended": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueriesForBackgroundActivity, // Sidebar rows render active workflow/background task state.
      dirtyThreadSearchQueries, // Indexed conversation content may now match a search query.
      dirtyThreadTimelineQueries, // Timeline rows are built from appended events.
      dirtyThreadPromptHistoryQueriesForTurnRequests, // Follow-up recall is built from client turn requests.
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
      dirtyThreadListQueries, // List rows render status/runtime badges.
      dirtyThreadDetailQueries, // Detail controls and banners depend on status.
    ],
  },
  "title-changed": {
    flush: "debounced",
    dirty: [
      dirtyThreadListQueries, // List rows render display title.
      dirtyThreadDetailQueries, // Detail headers and breadcrumbs render display title.
      dirtyAutomationQueries, // Automation rows reference the spawning thread by title.
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
      dirtyAutomationQueries, // Automation rows reference the spawning thread.
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
      dirtyThreadListQueries, // Thread rows render environment/worktree metadata.
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
      dirtyEnvironmentLiveWorkspaceStateQueries, // Refresh live workspace-derived views after file edits.
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
      dirtyAutomationQueries, // Automation rows render the owning project's name.
    ],
  },
  "project-deleted": {
    dirty: [
      dirtyProjectListQueries, // Deleted projects must disappear from navigation/pickers.
      dirtyAutomationQueries, // Deleting a project cascades its automations out of the overview.
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
  "automations-changed": {
    dirty: [
      dirtyAutomationQueries, // Automation create/update/pause/resume/delete changes the overview.
    ],
  },
  "automation-runs-changed": {
    dirty: [
      dirtyAutomationQueries, // A new/closed run updates the denormalized last-run summary on rows.
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
      dirtySystemProviderQueries,
      dirtySystemExecutionOptionQueries,
    ],
  },
  // The live page reload after a UI-source rebuild is owned entirely by the
  // server-injected recovery shim (outside the editable app bundle), so the
  // app's cache layer does nothing here.
  "ui-reloaded": {
    dirty: [],
  },
  // Re-fetch UI-source status so the in-app status toast reflects a build
  // failure / rebase-needed / revert without a full reload.
  "ui-status-changed": {
    dirty: [dirtyUiSourceStatusQueries],
  },
} satisfies SystemChangeRegistry;

export type ThreadChangeFlushPriority = "debounced" | "immediate";

export interface RealtimeDirtyContext {
  queryClient: QueryClient;
}

export interface ThreadRealtimeDirtyContext extends RealtimeDirtyContext {
  backgroundActivityChanged: boolean | undefined;
  eventTypes: readonly ThreadEventType[] | undefined;
  hasPendingInteraction: boolean | undefined;
  projectId: string | undefined;
  threadId: string | undefined;
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

function dirtyThreadListQueriesForBackgroundActivity(
  context: ThreadRealtimeDirtyContext,
): QueryKey[] {
  if (context.backgroundActivityChanged !== true) {
    return [];
  }
  return dirtyThreadListQueries(context);
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

function dirtyThreadSearchQueries(): QueryKey[] {
  return [threadSearchQueryKeyPrefix()];
}

function dirtyThreadTimelineQueries({
  queryClient,
  threadId,
}: ThreadRealtimeDirtyContext): void {
  // Window only: completed turn-summary-details are immutable, so realtime
  // event batches must not refetch open detail panels (see helper docs).
  invalidateQueryKeysWithoutCancelingActiveFetches({
    queryClient,
    queryKeys: getThreadTimelineWindowInvalidationQueryKeys({ threadId }),
  });
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
  queryClient.invalidateQueries({
    queryKey: environmentWorkStatusQueryKeyPrefix(environmentId),
  });
  queryClient.invalidateQueries({
    queryKey: environmentPullRequestQueryKey(environmentId),
  });
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

function dirtyAutomationQueries(): QueryKey[] {
  // The realtime change kinds (`automations-changed`, `automation-runs-changed`)
  // don't carry the affected automation's project + id, so dirty the whole
  // detail/runs families by prefix alongside the cross-project overview. This
  // keeps an open detail view live-updating after a run completes or the
  // automation is paused/resumed elsewhere.
  return [
    automationsQueryKey(),
    allAutomationDetailQueryKeyPrefix(),
    allAutomationRunsQueryKeyPrefix(),
  ];
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

function dirtySystemProviderQueries(): QueryKey[] {
  return [systemProvidersQueryKey()];
}

function dirtySystemExecutionOptionQueries(): QueryKey[] {
  return [allSystemExecutionOptionsQueryKeyPrefix()];
}

function dirtyUiSourceStatusQueries(): QueryKey[] {
  return [uiSourceStatusQueryKey()];
}
