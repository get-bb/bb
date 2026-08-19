import type { QueryKey } from "@tanstack/react-query";
import {
  allEnvironmentDiffFilesQueryKeyPrefix,
  allEnvironmentDiffPatchQueryKeyPrefix,
  allEnvironmentFilePreviewQueryKeyPrefix,
  allEnvironmentMergeBaseBranchesQueryKeyPrefix,
  allEnvironmentQueryKeyPrefix,
  allEnvironmentWorkStatusQueryKeyPrefix,
  allHostQueryKeyPrefix,
  allProjectPathsQueryKeyPrefix,
  allSystemExecutionOptionsQueryKeyPrefix,
  allSystemProvidersQueryKeyPrefix,
  allTerminalsQueryKeyPrefix,
  allThreadConversationOutlineQueryKeyPrefix,
  allThreadDetailBootstrapQueryKeyPrefix,
  allThreadHostFilePreviewQueryKeyPrefix,
  allThreadPendingInteractionsQueryKeyPrefix,
  allThreadQueuedMessagesQueryKeyPrefix,
  allThreadQueryKeyPrefix,
  allThreadStorageFilePreviewQueryKeyPrefix,
  allThreadStorageFilesQueryKeyPrefix,
  allThreadStoragePathsQueryKeyPrefix,
  allThreadTimelineQueryKeyPrefix,
  allThreadTimelineTurnSummaryDetailsQueryKeyPrefix,
  hostPathExistenceQueryKeyPrefix,
  hostsQueryKey,
  projectsQueryKey,
  sidebarNavigationQueryKey,
  systemConfigQueryKey,
  threadPromptHistoryQueryKeyPrefix,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
} from "../queries/query-keys";
import { allThreadDefaultExecutionOptionsQueryKeyPrefix } from "../queries/thread-default-execution-options-query";
import type { QueryClientArg } from "../cache-effect-types";
import { bumpAllDiffPatchEvictionGenerations } from "./environment-diff-patch-cache-owner";
import { invalidateSystemVersion } from "./system-version-cache-owner";
import {
  invalidateQueryKeys,
  refetchFailedActiveQueryKeys,
} from "./cache-effect-utils";

interface SystemExecutionOptionsInvalidationArgs extends QueryClientArg {
  hostId: string;
}

interface ServerReconnectInvalidationArgs extends QueryClientArg {
  /**
   * Last moment the previous socket was known healthy. Data that resolved
   * after it observed server state the socket could not have missed, so it is
   * left alone; everything older (including never-loaded and errored queries,
   * whose `dataUpdatedAt` is 0) is refetched.
   */
  disconnectedAt: number;
}

/**
 * Reconnect catch-up. Mirrors the initial-connect watermark rather than a
 * blanket invalidation: on a phone every app switch reconnects the socket
 * while focus refetches and the flush of changes merged while hidden are
 * already loading the visible thread. A blanket invalidate with the default
 * `cancelRefetch: true` would abort those partially downloaded responses and
 * start every one over.
 */
export function invalidateRealtimeQueriesAfterServerReconnect({
  disconnectedAt,
  queryClient,
}: ServerReconnectInvalidationArgs): void {
  for (const queryKey of getServerReconnectInvalidationQueryKeys()) {
    void queryClient.invalidateQueries(
      {
        queryKey,
        predicate: (query) => query.state.dataUpdatedAt < disconnectedAt,
      },
      // A fetch already in flight resolves to post-reconnect data; keep it.
      { cancelRefetch: false },
    );
  }
  // A reconnect is how the app learns the server restarted, which is exactly
  // what a bb self-update does — so re-check the version rather than keep
  // advertising the update the user just applied.
  invalidateSystemVersion({ queryClient });
  // The per-file diff patch cache is observer-less: invalidation only marks it
  // stale and never refetches or evicts, so a reconnect must remove it. The
  // diff TOC refetch (invalidated above) then drives the panel to re-request
  // and repopulate the visible patches.
  //
  // Bump every environment's eviction generation synchronously so a patch fetch
  // that was in flight across the reconnect drops its now-stale write instead
  // of re-seeding the just-cleared cache.
  bumpAllDiffPatchEvictionGenerations();
  queryClient.removeQueries({
    queryKey: allEnvironmentDiffPatchQueryKeyPrefix(),
  });
}

export function refetchErroredRealtimeQueriesOnInitialConnect({
  queryClient,
}: QueryClientArg): void {
  refetchFailedActiveQueryKeys({
    queryClient,
    queryKeys: getServerReconnectInvalidationQueryKeys(),
  });
}

interface InitialConnectInvalidationArgs extends QueryClientArg {
  /** Timestamp at which the realtime subscriptions became active. */
  connectedAt: number;
}

/**
 * A query that resolved before the realtime subscriptions were active may have
 * missed change events published in between, and nothing later corrects it:
 * the initial-connect path never fires again and staleTime defers mount/focus
 * refetches. On desktop cold start this window is real — the host daemon opens
 * its session a few hundred ms after the server starts listening, so the first
 * hosts/providers fetches capture "disconnected" and the `host-connected`
 * broadcast lands before the app's subscription registers. Invalidate any
 * realtime query whose data predates the subscription watermark; queries that
 * resolve after it observe post-subscribe server state and stay untouched.
 */
export function invalidateRealtimeQueriesFetchedBeforeInitialConnect({
  connectedAt,
  queryClient,
}: InitialConnectInvalidationArgs): void {
  for (const queryKey of getServerReconnectInvalidationQueryKeys()) {
    queryClient.invalidateQueries({
      queryKey,
      predicate: (query) =>
        query.state.dataUpdatedAt !== 0 &&
        query.state.dataUpdatedAt < connectedAt,
    });
  }
}

/**
 * Refresh `/system/config` after an experiments write: the server broadcast
 * covers other windows, this gives the writing window an immediate re-gate.
 */
export function invalidateSystemConfig({ queryClient }: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: systemConfigQueryKey() });
}

/** Refresh provider/model catalogs after a provider CLI install or update. */
export function invalidateSystemExecutionOptions({
  hostId,
  queryClient,
}: SystemExecutionOptionsInvalidationArgs): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
    predicate: (query) =>
      query.queryKey[2] === hostId || query.queryKey[2] === null,
  });
}

/** Refresh settings and timeline projections after a General settings write. */
export function invalidateGeneralSettingsDependencies({
  queryClient,
}: QueryClientArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      systemConfigQueryKey(),
      allThreadTimelineQueryKeyPrefix(),
      allThreadTimelineTurnSummaryDetailsQueryKeyPrefix(),
    ],
  });
}

function getServerReconnectInvalidationQueryKeys(): QueryKey[] {
  return [
    hostsQueryKey(),
    allHostQueryKeyPrefix(),
    projectsQueryKey(),
    sidebarNavigationQueryKey(),
    allProjectPathsQueryKeyPrefix(),
    threadsQueryKey(),
    threadSearchQueryKeyPrefix(),
    allThreadQueryKeyPrefix(),
    allThreadDetailBootstrapQueryKeyPrefix(),
    allThreadTimelineQueryKeyPrefix(),
    allThreadConversationOutlineQueryKeyPrefix(),
    allThreadTimelineTurnSummaryDetailsQueryKeyPrefix(),
    allThreadQueuedMessagesQueryKeyPrefix(),
    threadPromptHistoryQueryKeyPrefix(),
    allThreadPendingInteractionsQueryKeyPrefix(),
    allThreadDefaultExecutionOptionsQueryKeyPrefix(),
    allThreadStorageFilesQueryKeyPrefix(),
    allThreadStoragePathsQueryKeyPrefix(),
    allThreadStorageFilePreviewQueryKeyPrefix(),
    allThreadHostFilePreviewQueryKeyPrefix(),
    allTerminalsQueryKeyPrefix(),
    allEnvironmentQueryKeyPrefix(),
    allEnvironmentWorkStatusQueryKeyPrefix(),
    allEnvironmentMergeBaseBranchesQueryKeyPrefix(),
    // The diff TOC has a real observer, so it refetches on invalidate. The
    // per-file patch cache is observer-less and is evicted separately in
    // invalidateRealtimeQueriesAfterServerReconnect (invalidation is a no-op for
    // it), so it is intentionally absent from this list.
    allEnvironmentDiffFilesQueryKeyPrefix(),
    allEnvironmentFilePreviewQueryKeyPrefix(),
    hostPathExistenceQueryKeyPrefix(),
    allSystemProvidersQueryKeyPrefix(),
    allSystemExecutionOptionsQueryKeyPrefix(),
  ];
}
