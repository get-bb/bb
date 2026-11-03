import type { QueryClient } from "@tanstack/react-query";
import { threadQueryKey } from "../queries/query-keys";
import { threadQueryOptions } from "../queries/thread-queries";

export function readThreadBack(
  queryClient: QueryClient,
): (threadId: string) => Promise<void> {
  return async (threadId) => {
    await queryClient.cancelQueries({
      queryKey: threadQueryKey(threadId),
      exact: true,
    });
    await queryClient.prefetchQuery({
      ...threadQueryOptions(queryClient, threadId),
      staleTime: 0,
    });
  };
}
