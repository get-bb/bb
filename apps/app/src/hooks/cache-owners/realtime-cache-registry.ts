import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type {
  AppChangeKind,
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
  allThreadSchedulesQueryKeyPrefix,
  automationsOverviewQueryKey,
  allAppMarkdownPreviewQueryKeyPrefix,
  allAppQueryKeyPrefix,
  allAppsQueryKeyPrefix,
  allSystemExecutionOptionsQueryKeyPrefix,
  appMarkdownPreviewQueryKeyPrefix,
  appQueryKey,
  appSourcesQueryKey,
  allThreadQueryKeyPrefix,
  allThreadTerminalsQueryKeyPrefix,
  environmentDiffFilesQueryKeyPrefix,
  environmentFilePreviewQueryKeyPrefix,
  environmentWorkStatusQueryKeyPrefix,
  hostsQueryKey,
  sidebarNavigationQueryKey,
  systemProvidersQueryKey,
  threadQueryKey,
  threadTerminalsQueryKey,
  threadsQueryKey,
  threadStorageFilePreviewQueryKeyPrefix,
  threadStorageFilesForThreadQueryKeyPrefix,
  threadStoragePathsForThreadQueryKeyPrefix,
} from "../queries/query-keys";
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
} from "./cache-invalidation-groups";

interface CollectCachedThreadIdsForEnvironmentArgs {
  environmentId: string;
  queryClient: QueryClient;
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
      dirtyAutomationOverviewQueries, // Overview rows include thread schedule targets.
      dirtyThreadListQueries, // Deleted thread must disappear from lists.
      dirtyThreadDetailQueries, // Active detail should reconcile to deleted/not-found.
      dirtyThreadTimelineQueries, // Active timeline should stop showing stale rows.
      dirtyProjectPromptHistoryQueries, // Deleted prompts may leave project history.
    ],
  },
  "events-appended": {
    flush: "debounced",
    dirty: [
      dirtyThreadTimelineQueries, // Timeline rows are built from appended events.
      dirtyThreadPromptHistoryQueriesForTurnRequests, // Follow-up recall is built from client turn requests.
    ],
  },
  "interactions-changed": {
    flush: "debounced",
    dirty: [
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
      dirtyAutomationOverviewQueries, // Overview rows render schedule target titles.
      dirtyThreadListQueries, // List rows render display title.
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
      dirtyAutomationOverviewQueries, // Overview rows render archived target state.
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
      dirtyAutomationOverviewQueries, // Overview rows render project names.
      dirtyProjectListQueries, // Name/settings fields are embedded in sidebar navigation/project caches.
    ],
  },
  "project-deleted": {
    dirty: [
      dirtyAutomationOverviewQueries, // Overview rows hide deleted projects.
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
  "automations-changed": {
    dirty: [
      dirtyAutomationOverviewQueries, // Overview lists project automation rows directly.
      dirtyProjectListQueries, // Sidebar/project caches still carry project-level change context.
    ],
  },
  "thread-schedules-changed": {
    dirty: [
      dirtyAutomationOverviewQueries, // Overview lists thread schedule rows directly.
      dirtyThreadScheduleQueries, // Info tabs read per-thread schedules.
      dirtyProjectListQueries, // Sidebar/project caches still carry project-level change context.
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
    dirty: [dirtySystemProviderQueries, dirtySystemExecutionOptionQueries],
  },
  "apps-changed": {
    dirty: [dirtyAppListQueries],
  },
} satisfies SystemChangeRegistry;

export const REALTIME_APP_CHANGE_REGISTRY = {
  "apps-changed": {
    dirty: [], // List-level invalidation rides system:apps-changed (the canonical path); handling it here too would double-invalidate.
  },
  "content-changed": {
    dirty: [dirtyAppContentQueries], // Served public/ files changed; reload just that app's open surfaces.
  },
} satisfies AppChangeRegistry;

export type ThreadChangeFlushPriority = "debounced" | "immediate";

export interface RealtimeDirtyContext {
  queryClient: QueryClient;
}

export interface ThreadRealtimeDirtyContext extends RealtimeDirtyContext {
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

export interface AppRealtimeDirtyContext extends RealtimeDirtyContext {
  applicationId: string | undefined;
}

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

export type SystemChangeRegistry = Record<SystemChangeKind, SystemChangeRule>;

export interface AppChangeRule {
  dirty: readonly RealtimeDirtyHandler<AppRealtimeDirtyContext>[];
}

export type AppChangeRegistry = Record<AppChangeKind, AppChangeRule>;

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

function dirtyThreadTimelineQueries({
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

function dirtyThreadPendingInteractionQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return getThreadPendingInteractionInvalidationQueryKeys({ threadId });
}

function dirtyThreadTerminalQueries({
  threadId,
}: ThreadRealtimeDirtyContext): QueryKey[] {
  return threadId
    ? [threadTerminalsQueryKey(threadId)]
    : [allThreadTerminalsQueryKeyPrefix()];
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

function dirtyAutomationOverviewQueries(): QueryKey[] {
  return [automationsOverviewQueryKey()];
}

function dirtyThreadScheduleQueries(): QueryKey[] {
  return [allThreadSchedulesQueryKeyPrefix()];
}

function dirtyProjectSourceDependentQueries({
  projectId,
}: ProjectRealtimeDirtyContext): QueryKey[] {
  return getProjectSourceDependentInvalidationQueryKeys({ projectId });
}

function dirtyHostAvailabilityQueries(): QueryKey[] {
  return [hostsQueryKey(), allHostQueryKeyPrefix()];
}

function dirtySystemProviderQueries(): QueryKey[] {
  return [systemProvidersQueryKey()];
}

function dirtySystemExecutionOptionQueries(): QueryKey[] {
  return [allSystemExecutionOptionsQueryKeyPrefix()];
}

function dirtyAppListQueries(): QueryKey[] {
  return [
    allAppsQueryKeyPrefix(),
    allAppQueryKeyPrefix(),
    allAppMarkdownPreviewQueryKeyPrefix(),
    // App-source syncs broadcast apps-changed; source status (commit,
    // per-app states) moves together with the app list.
    appSourcesQueryKey(),
  ];
}

function dirtyAppContentQueries(context: AppRealtimeDirtyContext): QueryKey[] {
  if (context.applicationId === undefined) {
    // Defensive: a content change without app identity falls back to the
    // every-app scope so no open surface misses the reload.
    return [allAppQueryKeyPrefix(), allAppMarkdownPreviewQueryKeyPrefix()];
  }
  return [
    appQueryKey(context.applicationId), // Detail refetch bumps dataUpdatedAt, which busts the iframe reloadToken.
    appMarkdownPreviewQueryKeyPrefix(context.applicationId), // Markdown entries re-render from the refetched content.
  ];
}
