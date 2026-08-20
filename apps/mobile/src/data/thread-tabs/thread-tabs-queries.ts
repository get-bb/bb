import type { ThreadTabsResponse } from "@bb/server-contract";
import { useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { threadTabsQueryKey } from "@/lib/query/query-keys";
import { requireEnabledQueryArg } from "../shared/query-helpers";
import { useThreadDetailRealtimeSubscription } from "../shared/use-realtime-subscription";

interface QueryOptions {
  enabled?: boolean;
}

/**
 * `GET /threads/:id/tabs`: the server-synced panel tab strip (revision +
 * tabs). Realtime `tabs-changed` invalidates it when another client writes;
 * a resume refetches so a strip edited on the desktop while the phone slept
 * catches up.
 */
export function useThreadTabs(
  threadId: string | null | undefined,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && Boolean(threadId);
  useThreadDetailRealtimeSubscription(threadId, { enabled });
  return useQuery<ThreadTabsResponse>({
    queryKey: threadTabsQueryKey(threadId ?? ""),
    queryFn: ({ signal }) =>
      sdk.threads.tabs.get({
        threadId: requireEnabledQueryArg({
          value: threadId,
          hookName: "useThreadTabs",
          argName: "threadId",
        }),
        signal,
      }),
    enabled,
    staleTime: 30_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
}
