import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import type { ThreadListEntry } from "@bb/domain";

export type ThreadListCacheData =
  | ThreadListEntry[]
  | InfiniteData<ThreadListEntry[]>;

function isThreadListEntryArray(value: unknown): value is ThreadListEntry[] {
  return Array.isArray(value);
}

function isInfiniteThreadListData(
  value: unknown,
): value is InfiniteData<ThreadListEntry[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    "pages" in value &&
    Array.isArray((value as { pages: unknown }).pages)
  );
}

export function* iterateThreadListCacheEntries(
  data: ThreadListCacheData | undefined,
): Iterable<ThreadListEntry> {
  if (!data) {
    return;
  }
  if (isThreadListEntryArray(data)) {
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

function isThreadListCacheData(value: unknown): value is ThreadListCacheData {
  return isThreadListEntryArray(value) || isInfiniteThreadListData(value);
}

interface CachedThreadList {
  queryKey: QueryKey;
  data: ThreadListCacheData;
}

interface ThreadListCacheQueryOptions {
  queryKey: QueryKey;
}

export function getCachedThreadLists(
  queryClient: QueryClient,
  options: ThreadListCacheQueryOptions,
): CachedThreadList[] {
  const result: CachedThreadList[] = [];
  for (const [queryKey, data] of queryClient.getQueriesData({
    queryKey: options.queryKey,
  })) {
    if (!isThreadListCacheData(data)) {
      continue;
    }
    result.push({ queryKey, data });
  }
  return result;
}
