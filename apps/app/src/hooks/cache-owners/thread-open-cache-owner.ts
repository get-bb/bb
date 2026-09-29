import type { QueryClient } from "@tanstack/react-query";
import { getMediaQuerySnapshot } from "@bb/shared-ui/hooks/use-media-query";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  threadDetailBootstrapQueryKey,
  threadTimelineQueryKey,
  threadTimelineQueryKeyPrefix,
} from "../queries/query-keys";

export const THREAD_OPEN_CACHE_GC_MS = 60 * 60_000;
export const THREAD_OPEN_CACHE_MAX_THREADS = 20;
export const COARSE_POINTER_THREAD_OPEN_CACHE_MAX_THREADS = 8;

const threadOpenCacheTouchesByClient = new WeakMap<QueryClient, Set<string>>();

function resolveThreadOpenCacheMaxThreads(): number {
  return getMediaQuerySnapshot(POINTER_COARSE_QUERY)
    ? COARSE_POINTER_THREAD_OPEN_CACHE_MAX_THREADS
    : THREAD_OPEN_CACHE_MAX_THREADS;
}

function isThreadOpenCacheActive(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  const queryCache = queryClient.getQueryCache();
  return (
    queryCache
      .find({ queryKey: threadTimelineQueryKey(threadId), exact: true })
      ?.isActive() === true ||
    queryCache
      .find({ queryKey: threadDetailBootstrapQueryKey(threadId), exact: true })
      ?.isActive() === true
  );
}

function evictThreadOpenCache(
  queryClient: QueryClient,
  touched: Set<string>,
): void {
  const maxThreads = resolveThreadOpenCacheMaxThreads();
  for (const threadId of touched) {
    if (touched.size <= maxThreads) {
      return;
    }
    if (isThreadOpenCacheActive(queryClient, threadId)) {
      continue;
    }
    queryClient.removeQueries({
      queryKey: threadTimelineQueryKeyPrefix(threadId),
      type: "inactive",
    });
    queryClient.removeQueries({
      queryKey: threadDetailBootstrapQueryKey(threadId),
      exact: true,
      type: "inactive",
    });
    touched.delete(threadId);
  }
}

export function touchThreadOpenCache(
  queryClient: QueryClient,
  threadId: string,
): void {
  let touched = threadOpenCacheTouchesByClient.get(queryClient);
  if (touched === undefined) {
    touched = new Set();
    threadOpenCacheTouchesByClient.set(queryClient, touched);
  }
  touched.delete(threadId);
  touched.add(threadId);
  evictThreadOpenCache(queryClient, touched);
}
