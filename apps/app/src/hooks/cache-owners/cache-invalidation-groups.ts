import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getCachedProjectThreadListInvalidationQueryKeys } from "./query-cache";
import {
  allProjectPathsQueryKeyPrefix,
  allProjectSourceBranchesQueryKeyPrefix,
  allThreadConversationOutlineQueryKeyPrefix,
  allThreadPendingInteractionsQueryKeyPrefix,
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

/**
 * Timeline-window-only invalidation for realtime `events-appended` /
 * `thread-created` / `thread-deleted`. Deliberately excludes the full-thread
 * conversation outline and completed turn details: their refresh policies are
 * independent of the live window. Mutations that can rewrite history
 * (fork/retry/edit) still use {@link getThreadTimelineInvalidationQueryKeys}.
 */
export function getThreadTimelineWindowInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  return threadId
    ? [threadTimelineQueryKeyPrefix(threadId)]
    : [allThreadTimelineQueryKeyPrefix()];
}

export function getThreadConversationOutlineInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  return threadId
    ? [threadConversationOutlineQueryKeyPrefix(threadId)]
    : [allThreadConversationOutlineQueryKeyPrefix()];
}

export function getThreadQueueContentInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  if (!threadId) {
    return [
      allThreadQueuedMessagesQueryKeyPrefix(),
      threadPromptHistoryQueryKeyPrefix(),
    ];
  }
  return [
    threadQueuedMessagesQueryKey(threadId),
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
