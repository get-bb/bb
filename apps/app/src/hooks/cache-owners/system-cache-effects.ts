import type { QueryKey } from "@tanstack/react-query";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import {
  allEnvironmentGitDiffQueryKeyPrefix,
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
    allEnvironmentGitDiffQueryKeyPrefix(),
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
