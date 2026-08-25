import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getCachedProjectThreadListInvalidationQueryKeys } from "./query-cache";
import {
  allProjectPathsQueryKeyPrefix,
  allProjectSourceBranchesQueryKeyPrefix,
  allThreadConversationOutlineQueryKeyPrefix,
  allThreadPendingInteractionsQueryKeyPrefix,
  allThreadDispatchHoldsQueryKeyPrefix,
  allThreadQueuedMessagesQueryKeyPrefix,
  allThreadQueryKeyPrefix,
  allThreadTimelineQueryKeyPrefix,
  allThreadTimelineTurnSummaryDetailsQueryKeyPrefix,
  hostPathExistenceQueryKeyPrefix,
  projectPathsQueryKeyPrefix,
  projectPromptHistoryQueryKey,
  projectPromptHistoryQueryKeyPrefix,
  projectSourceBranchesQueryKeyPrefix,
  projectsQueryKey,
  sidebarNavigationQueryKey,
  threadDispatchHoldsQueryKey,
  threadQueuedMessagesQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadPromptHistoryQueryKeyPrefix,
  threadQueryKey,
  threadConversationOutlineQueryKeyPrefix,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
  threadTimelineQueryKeyPrefix,
  threadTimelineTurnSummaryDetailsQueryKeyPrefix,
} from "../queries/query-keys";

interface ProjectScopedInvalidationArgs {
  projectId: string | undefined;
}

interface ThreadScopedInvalidationArgs {
  threadId: string | undefined;
}

interface ThreadListInvalidationArgs extends ProjectScopedInvalidationArgs {
  queryClient: QueryClient;
}

export function getProjectListInvalidationQueryKeys(): QueryKey[] {
  return [
    projectsQueryKey(),
    sidebarNavigationQueryKey(),
    threadSearchQueryKeyPrefix(),
  ];
}

export function getProjectPromptHistoryInvalidationQueryKeys({
  projectId,
}: ProjectScopedInvalidationArgs): QueryKey[] {
  return projectId
    ? [projectPromptHistoryQueryKey(projectId)]
    : [projectPromptHistoryQueryKeyPrefix()];
}

export function getProjectSourceDependentInvalidationQueryKeys({
  projectId,
}: ProjectScopedInvalidationArgs): QueryKey[] {
  const sharedKeys: QueryKey[] = [
    projectsQueryKey(),
    sidebarNavigationQueryKey(),
    hostPathExistenceQueryKeyPrefix(),
  ];
  if (!projectId) {
    return [
      ...sharedKeys,
      allProjectPathsQueryKeyPrefix(),
      allProjectSourceBranchesQueryKeyPrefix(),
    ];
  }
  return [
    ...sharedKeys,
    projectPathsQueryKeyPrefix(projectId),
    projectSourceBranchesQueryKeyPrefix(projectId),
  ];
}

export function getThreadListInvalidationQueryKeys({
  projectId,
  queryClient,
}: ThreadListInvalidationArgs): QueryKey[] {
  const threadListQueryKeys = projectId
    ? getCachedProjectThreadListInvalidationQueryKeys({
        projectId,
        queryClient,
      })
    : [threadsQueryKey()];
  return [
    ...threadListQueryKeys,
    sidebarNavigationQueryKey(),
    threadSearchQueryKeyPrefix(),
  ];
}

export function getThreadDetailInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  return threadId ? [threadQueryKey(threadId)] : [allThreadQueryKeyPrefix()];
}

export function getThreadTimelineInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  return threadId
    ? [
        threadTimelineQueryKeyPrefix(threadId),
        threadConversationOutlineQueryKeyPrefix(threadId),
        threadTimelineTurnSummaryDetailsQueryKeyPrefix(threadId),
      ]
    : [
        allThreadTimelineQueryKeyPrefix(),
        allThreadConversationOutlineQueryKeyPrefix(),
        allThreadTimelineTurnSummaryDetailsQueryKeyPrefix(),
      ];
}

export function getThreadConversationOutlineInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  return threadId
    ? [threadConversationOutlineQueryKeyPrefix(threadId)]
    : [allThreadConversationOutlineQueryKeyPrefix()];
}

export function getThreadTimelineWindowInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  return threadId
    ? [threadTimelineQueryKeyPrefix(threadId)]
    : [allThreadTimelineQueryKeyPrefix()];
}

export function getThreadQueueContentInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  // Dispatch holds ride this group: the server notifies `queue-changed` when a
  // hold is created, reported on, released, or cancelled, and the pending
  // region renders holds and queued messages as one stack.
  if (!threadId) {
    return [
      allThreadQueuedMessagesQueryKeyPrefix(),
      allThreadDispatchHoldsQueryKeyPrefix(),
      threadPromptHistoryQueryKeyPrefix(),
    ];
  }
  return [
    threadQueuedMessagesQueryKey(threadId),
    threadDispatchHoldsQueryKey(threadId),
    threadPromptHistoryQueryKey(threadId),
  ];
}

export function getThreadPromptHistoryInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  return threadId
    ? [threadPromptHistoryQueryKey(threadId)]
    : [threadPromptHistoryQueryKeyPrefix()];
}

export function getThreadPendingInteractionInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  return threadId
    ? [threadPendingInteractionsQueryKey(threadId)]
    : [allThreadPendingInteractionsQueryKeyPrefix()];
}
