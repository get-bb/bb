import type { QueryKey } from "@tanstack/react-query";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import {
  allEnvironmentDiffFilesQueryKeyPrefix,
  allEnvironmentDiffPatchQueryKeyPrefix,
  allEnvironmentFilePreviewQueryKeyPrefix,
  allEnvironmentMergeBaseBranchesQueryKeyPrefix,
  allEnvironmentQueryKeyPrefix,
  allEnvironmentWorkStatusQueryKeyPrefix,
  allHostQueryKeyPrefix,
  allWorkflowRunAgentEventsQueryKeyPrefix,
  allWorkflowRunEventsQueryKeyPrefix,
  allWorkflowRunQueryKeyPrefix,
  allWorkflowRunsQueryKeyPrefix,
  allWorkflowsQueryKeyPrefix,
  allProjectPathsQueryKeyPrefix,
  allSystemExecutionOptionsQueryKeyPrefix,
  allThreadDefaultExecutionOptionsQueryKeyPrefix,
  allAppMarkdownPreviewQueryKeyPrefix,
  allAppQueryKeyPrefix,
  allAppsQueryKeyPrefix,
  allThreadQueuedMessagesQueryKeyPrefix,
  allThreadPendingInteractionsQueryKeyPrefix,
  allThreadQueryKeyPrefix,
  allThreadStorageFilePreviewQueryKeyPrefix,
  allThreadStorageFilesQueryKeyPrefix,
  allThreadStoragePathsQueryKeyPrefix,
  allThreadTimelineQueryKeyPrefix,
  allThreadTimelineTurnSummaryDetailsQueryKeyPrefix,
  hostsQueryKey,
  localPathExistenceQueryKeyPrefix,
  projectsQueryKey,
  replayCapturesQueryKey,
  sidebarNavigationQueryKey,
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemProvidersQueryKey,
  threadPromptHistoryQueryKeyPrefix,
  threadsQueryKey,
} from "../queries/query-keys";
import type { QueryClientArg } from "../cache-effect-types";
import { bumpAllDiffPatchEvictionGenerations } from "./environment-diff-patch-cache-owner";
import {
  invalidateQueryKeys,
  refetchFailedActiveQueryKeys,
} from "./cache-effect-utils";

interface SystemExecutionOptionsCacheArgs extends QueryClientArg {
  environmentId: string | null;
  executionOptions: SystemExecutionOptionsResponse;
  providerId: string | null;
}

export function seedSystemExecutionOptionsCache({
  environmentId,
  executionOptions,
  providerId,
  queryClient,
}: SystemExecutionOptionsCacheArgs): void {
  queryClient.setQueryData<SystemExecutionOptionsResponse>(
    systemExecutionOptionsQueryKey({ environmentId, providerId }),
    executionOptions,
  );
}

export function invalidateRealtimeQueriesAfterServerReconnect({
  queryClient,
}: QueryClientArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: getServerReconnectInvalidationQueryKeys(),
  });
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

/**
 * Refresh `/system/config` after an experiments write: the server broadcast
 * covers other windows, this gives the writing window an immediate re-gate.
 */
export function invalidateSystemConfig({ queryClient }: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: systemConfigQueryKey() });
}

export function invalidateReplayCaptures({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: replayCapturesQueryKey() });
}

function getServerReconnectInvalidationQueryKeys(): QueryKey[] {
  return [
    hostsQueryKey(),
    allHostQueryKeyPrefix(),
    projectsQueryKey(),
    sidebarNavigationQueryKey(),
    allProjectPathsQueryKeyPrefix(),
    threadsQueryKey(),
    allThreadQueryKeyPrefix(),
    allThreadTimelineQueryKeyPrefix(),
    allThreadTimelineTurnSummaryDetailsQueryKeyPrefix(),
    allThreadQueuedMessagesQueryKeyPrefix(),
    threadPromptHistoryQueryKeyPrefix(),
    allThreadPendingInteractionsQueryKeyPrefix(),
    allThreadDefaultExecutionOptionsQueryKeyPrefix(),
    allAppsQueryKeyPrefix(),
    allAppQueryKeyPrefix(),
    allAppMarkdownPreviewQueryKeyPrefix(),
    allThreadStorageFilesQueryKeyPrefix(),
    allThreadStoragePathsQueryKeyPrefix(),
    allThreadStorageFilePreviewQueryKeyPrefix(),
    allEnvironmentQueryKeyPrefix(),
    allEnvironmentWorkStatusQueryKeyPrefix(),
    allEnvironmentMergeBaseBranchesQueryKeyPrefix(),
    // The diff TOC has a real observer, so it refetches on invalidate. The
    // per-file patch cache is observer-less and is evicted separately in
    // invalidateRealtimeQueriesAfterServerReconnect (invalidation is a no-op for
    // it), so it is intentionally absent from this list.
    allEnvironmentDiffFilesQueryKeyPrefix(),
    allEnvironmentFilePreviewQueryKeyPrefix(),
    localPathExistenceQueryKeyPrefix(),
    systemProvidersQueryKey(),
    allSystemExecutionOptionsQueryKeyPrefix(),
    // Workflow runs are realtime-fed: messages emitted while the socket was
    // down are lost, and a run that reached terminal during the gap emits
    // nothing afterward — without this, a focused run page or Workflows tab
    // renders the run frozen at its pre-disconnect state indefinitely.
    allWorkflowRunQueryKeyPrefix(),
    allWorkflowRunsQueryKeyPrefix(),
    allWorkflowRunEventsQueryKeyPrefix(),
    allWorkflowRunAgentEventsQueryKeyPrefix(),
    allWorkflowsQueryKeyPrefix(),
  ];
}
