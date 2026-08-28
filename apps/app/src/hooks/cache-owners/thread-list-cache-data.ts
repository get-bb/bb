import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import type { ThreadListEntry } from "@bb/domain";

export type ThreadListCacheData =
  | ThreadListEntry[]
  | InfiniteData<ThreadListEntry[]>;

export function* iterateThreadListCacheEntries(
  data: ThreadListCacheData | undefined,
): Iterable<ThreadListEntry> {
  if (!data) {
    return;
  }
  if (Array.isArray(data)) {
    for (const entry of data) {
      yield entry;
    }
    return;
  }
  for (const page of data.pages) {
    for (const entry of page) {
      yield entry;
    }
  }
}

function mapThreadListCacheData(
  data: ThreadListCacheData,
  mapper: (list: ThreadListEntry[]) => ThreadListEntry[],
): ThreadListCacheData {
  if (Array.isArray(data)) {
    return mapper(data);
  }
  return { ...data, pages: data.pages.map(mapper) };
}

interface CachedThreadList {
  queryKey: QueryKey;
  data: ThreadListCacheData;
}

export type CachedThreadListSnapshot = CachedThreadList[];

interface ThreadListCacheQueryOptions {
  queryKey: QueryKey;
}

interface ApplyToCachedThreadListsOptions extends ThreadListCacheQueryOptions {
  mapper: (list: ThreadListEntry[]) => ThreadListEntry[];
}

export function getCachedThreadLists(
  queryClient: QueryClient,
  options: ThreadListCacheQueryOptions,
): CachedThreadList[] {
  const result: CachedThreadList[] = [];
  for (const [
    queryKey,
    data,
  ] of queryClient.getQueriesData<ThreadListCacheData>({
    queryKey: options.queryKey,
  })) {
    if (data === undefined) {
      continue;
    }
    result.push({ queryKey, data });
  }
  return result;
}

export function restoreCachedThreadLists(
  queryClient: QueryClient,
  snapshot: CachedThreadListSnapshot,
): void {
  for (const { queryKey, data } of snapshot) {
    queryClient.setQueryData(queryKey, data);
  }
}

export function applyToCachedThreadLists(
  queryClient: QueryClient,
  options: ApplyToCachedThreadListsOptions,
): void {
  for (const { queryKey, data } of getCachedThreadLists(queryClient, {
    queryKey: options.queryKey,
  })) {
    queryClient.setQueryData(
      queryKey,
      mapThreadListCacheData(data, options.mapper),
    );
  }
}
