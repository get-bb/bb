import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
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

interface CachedLiveThreadDescendantIdsArgs {
  queryClient: QueryClient;
  threadId: string;
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

function* iterateCachedLiveThreads(
  queryClient: QueryClient,
): Generator<ThreadListEntry> {
  for (const { data } of getCachedThreadLists(queryClient, {
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of iterateThreadListCacheEntries(data)) {
      if (thread.archivedAt === null) {
        yield thread;
      }
    }
  }
  for (const thread of getCachedSidebarNavigationThreads(queryClient)) {
    if (thread.archivedAt === null) {
      yield thread;
    }
  }
}

export function getCachedLiveThreadIdsMatching({
  matchesThread,
  queryClient,
}: CachedLiveThreadIdsMatchingArgs): string[] {
  const threadIds = new Set<string>();
  for (const thread of iterateCachedLiveThreads(queryClient)) {
    if (matchesThread(thread)) {
      threadIds.add(thread.id);
    }
  }
  return Array.from(threadIds);
}

export function getCachedLiveThreadDescendantIds({
  queryClient,
  threadId,
}: CachedLiveThreadDescendantIdsArgs): string[] {
  const dependentIdsByOwnerId = new Map<string, Set<string>>();
  const addDependent = (ownerId: string | null, dependentId: string) => {
    if (ownerId === null || ownerId === dependentId) {
      return;
    }
    const dependentIds = dependentIdsByOwnerId.get(ownerId);
    if (dependentIds) {
      dependentIds.add(dependentId);
      return;
    }
    dependentIdsByOwnerId.set(ownerId, new Set([dependentId]));
  };
  for (const thread of iterateCachedLiveThreads(queryClient)) {
    addDependent(thread.parentThreadId, thread.id);
    addDependent(thread.lifecycleOwnerThreadId, thread.id);
  }

  const visited = new Set<string>([threadId]);
  const descendantIds: string[] = [];
  const pending = [threadId];
  while (pending.length > 0) {
    const ownerId = pending.shift();
    if (ownerId === undefined) {
      break;
    }
    for (const dependentId of dependentIdsByOwnerId.get(ownerId) ?? []) {
      if (visited.has(dependentId)) {
        continue;
      }
      visited.add(dependentId);
      descendantIds.push(dependentId);
      pending.push(dependentId);
    }
  }
  return descendantIds;
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
