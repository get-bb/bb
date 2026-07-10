import type { QueryClient } from "@tanstack/react-query";
import type { ThreadTabsResponse } from "@bb/server-contract";
import { threadTabsQueryKey } from "../queries/query-keys";

export function getCachedThreadTabs(
  queryClient: QueryClient,
  threadId: string,
): ThreadTabsResponse | undefined {
  return queryClient.getQueryData<ThreadTabsResponse>(
    threadTabsQueryKey(threadId),
  );
}

export function setCachedThreadTabs(
  queryClient: QueryClient,
  threadId: string,
  response: ThreadTabsResponse,
): void {
  queryClient.setQueryData(threadTabsQueryKey(threadId), response);
}

export function invalidateCachedThreadTabs(
  queryClient: QueryClient,
  threadId: string,
): void {
  queryClient.invalidateQueries({ queryKey: threadTabsQueryKey(threadId) });
}
