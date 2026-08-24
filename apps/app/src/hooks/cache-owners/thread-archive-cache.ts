import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
} from "@bb/client-core";
import { threadQueryKey, threadsQueryKey } from "../queries/query-keys";
import {
  applyToCachedSidebarNavigationThreads,
  getCachedSidebarNavigationThreads,
} from "./query-cache";
import {
  applyToCachedThreadLists,
  getCachedThreadLists,
  iterateThreadListCacheEntries,
} from "./thread-list-cache-data";

type CachedLiveThreadMatcher = (thread: ThreadListEntry) => boolean;

export interface CachedThreadSnapshot {
  id: string;
  thread: ThreadWithRuntime | undefined;
}

interface CachedLiveThreadIdsMatchingArgs {
  matchesThread: CachedLiveThreadMatcher;
  queryClient: QueryClient;
}

interface CachedThreadSnapshotsArgs {
  queryClient: QueryClient;
  threadIds: readonly string[];
}

interface OptimisticallyArchiveThreadsArgs {
  queryClient: QueryClient;
  threadIds: readonly string[];
}

interface RemoveLiveThreadsFromCachedListsArgs {
  matchesThread: CachedLiveThreadMatcher;
  queryClient: QueryClient;
}

export function getCachedLiveThreadIdsMatching({
  matchesThread,
  queryClient,
}: CachedLiveThreadIdsMatchingArgs): string[] {
  const threadIds = new Set<string>();
  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      if (thread.archivedAt === null && matchesThread(thread)) {
        threadIds.add(thread.id);
      }
    }
  }
  for (const thread of getCachedSidebarNavigationThreads(queryClient)) {
    if (thread.archivedAt === null && matchesThread(thread)) {
      threadIds.add(thread.id);
    }
  }
  return Array.from(threadIds);
}

/**
 * Counts cached live threads in an archive cascade that currently have working
 * activity. This stays synchronous so idle archives never wait on preflight.
 */
export function getCachedWorkingArchiveThreadCount({
  queryClient,
  threadId,
}: {
  queryClient: QueryClient;
  threadId: string;
}): number {
  const workingThreadIds = new Set<string>();
  const collectMatchingThread = (thread: ThreadListEntry) => {
    if (
      thread.archivedAt !== null ||
      (thread.id !== threadId && thread.parentThreadId !== threadId)
    ) {
      return;
    }
    if (
      isRuntimeBusyThread(thread) ||
      hasActiveWorkflowActivity(thread) ||
      hasActiveBackgroundAgentActivity(thread) ||
      hasActiveBackgroundCommandActivity(thread) ||
      hasActivePlanModeActivity(thread) ||
      hasActiveGoalActivity(thread)
    ) {
      workingThreadIds.add(thread.id);
    }
  };

  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      collectMatchingThread(thread);
    }
  }
  for (const thread of getCachedSidebarNavigationThreads(queryClient)) {
    collectMatchingThread(thread);
  }

  return workingThreadIds.size;
}

export function getCachedThreadSnapshots({
  queryClient,
  threadIds,
}: CachedThreadSnapshotsArgs): CachedThreadSnapshot[] {
  return threadIds.map((threadId) => ({
    id: threadId,
    thread: queryClient.getQueryData<ThreadWithRuntime>(
      threadQueryKey(threadId),
    ),
  }));
}

export function optimisticallyArchiveThreads({
  queryClient,
  threadIds,
}: OptimisticallyArchiveThreadsArgs): void {
  const archivedAt = Date.now();
  for (const threadId of threadIds) {
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey(threadId),
      (thread) => {
        if (!thread) {
          return thread;
        }
        return { ...thread, archivedAt };
      },
    );
  }
}

export function removeLiveThreadsFromCachedLists({
  matchesThread,
  queryClient,
}: RemoveLiveThreadsFromCachedListsArgs): void {
  const removeMatchingLiveThreads = (list: ThreadListEntry[]) =>
    list.filter(
      (thread) => thread.archivedAt !== null || !matchesThread(thread),
    );
  applyToCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
    mapper: removeMatchingLiveThreads,
  });
  applyToCachedSidebarNavigationThreads({
    queryClient,
    mapper: removeMatchingLiveThreads,
  });
}
