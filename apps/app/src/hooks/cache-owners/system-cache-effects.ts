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
  systemExecutionOptionsQueryKey,
  systemProvidersQueryKey,
  threadPromptHistoryQueryKeyPrefix,
  threadsQueryKey,
} from "../queries/query-keys";
import type { QueryClientArg } from "../cache-effect-types";
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

export function invalidateHostAvailabilityQueries({
  queryClient,
}: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: hostsQueryKey() });
  queryClient.invalidateQueries({ queryKey: allHostQueryKeyPrefix() });
}

export function invalidateHostChangeDependentQueries({
  queryClient,
}: QueryClientArg): void {
  invalidateHostAvailabilityQueries({ queryClient });
  queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
  queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  queryClient.invalidateQueries({ queryKey: systemProvidersQueryKey() });
  queryClient.invalidateQueries({
    queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
  });
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
  ];
}
