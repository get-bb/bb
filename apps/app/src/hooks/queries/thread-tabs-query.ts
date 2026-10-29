import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ThreadTabsResponse } from "@bb/server-contract";
import { resolveFetchedThreadTabs } from "@/hooks/cache-owners/thread-tabs-cache-owner";
import { sdk } from "@/lib/sdk";
import { threadTabsQueryKey } from "./query-keys";
import { RESUME_REFETCH_QUERY_POLICY } from "./query-policies";

interface ThreadTabsQueryOptions {
  enabled?: boolean;
}

export function useThreadTabs(
  threadId: string,
  options?: ThreadTabsQueryOptions,
) {
  const queryClient = useQueryClient();
  const enabled = (options?.enabled ?? true) && threadId.length > 0;

  return useQuery<ThreadTabsResponse>({
    queryKey: threadTabsQueryKey(threadId),
    queryFn: async ({ signal }) =>
      resolveFetchedThreadTabs(
        queryClient,
        threadId,
        await sdk.threads.tabs.get({ threadId, signal }),
      ),
    enabled,
    ...RESUME_REFETCH_QUERY_POLICY,
  });
}
