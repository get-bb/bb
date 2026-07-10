import { useQuery } from "@tanstack/react-query";
import type { ThreadTabsResponse } from "@bb/server-contract";
import { useThreadDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import * as api from "@/lib/api";
import { threadTabsQueryKey } from "./query-keys";
import { REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY } from "./query-policies";

interface ThreadTabsQueryOptions {
  enabled?: boolean;
}

export function useThreadTabs(
  threadId: string,
  options?: ThreadTabsQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && threadId.length > 0;
  useThreadDetailRealtimeSubscription(threadId, { enabled });

  return useQuery<ThreadTabsResponse>({
    queryKey: threadTabsQueryKey(threadId),
    queryFn: ({ signal }) => api.getThreadTabs(threadId, signal),
    enabled,
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  });
}
