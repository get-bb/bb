import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getCachedProjectThreadListInvalidationQueryKeys } from "./query-cache";
import {
  allProjectPathsQueryKeyPrefix,
  allProjectSourceBranchesQueryKeyPrefix,
  allThreadPendingInteractionsQueryKeyPrefix,
  allThreadQueuedMessagesQueryKeyPrefix,
  allThreadQueryKeyPrefix,
  allThreadTimelineFeedQueryKeyPrefix,
  allThreadTimelineRowDetailQueryKeyPrefix,
  allThreadTimelineTurnSummaryDetailsQueryKeyPrefix,
  localPathExistenceQueryKeyPrefix,
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
  threadsQueryKey,
  threadTimelineFeedQueryKeyPrefix,
  threadTimelineRowDetailQueryKeyPrefix,
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
  return [projectsQueryKey(), sidebarNavigationQueryKey()];
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
    localPathExistenceQueryKeyPrefix(),
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
  return [...threadListQueryKeys, sidebarNavigationQueryKey()];
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
        threadTimelineFeedQueryKeyPrefix(threadId),
        threadTimelineRowDetailQueryKeyPrefix(threadId),
        threadTimelineTurnSummaryDetailsQueryKeyPrefix(threadId),
      ]
    : [
        allThreadTimelineFeedQueryKeyPrefix(),
        allThreadTimelineRowDetailQueryKeyPrefix(),
        allThreadTimelineTurnSummaryDetailsQueryKeyPrefix(),
      ];
}

export function getThreadTimelineFeedInvalidationQueryKeys({
  threadId,
}: ThreadScopedInvalidationArgs): QueryKey[] {
  return threadId
    ? [threadTimelineFeedQueryKeyPrefix(threadId)]
    : [allThreadTimelineFeedQueryKeyPrefix()];
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
