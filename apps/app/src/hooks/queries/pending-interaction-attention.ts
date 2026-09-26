import { useQuery } from "@tanstack/react-query";
import type { ThreadPendingInteractionAttentionResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { useThreadListRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { hiddenThreadPendingInteractionAttentionQueryKey } from "./query-keys";
import { REALTIME_OWNED_NO_FOCUS_QUERY_POLICY } from "./query-policies";

export function useHiddenThreadPendingInteractionAttention() {
  useThreadListRealtimeSubscription();
  return useQuery<ThreadPendingInteractionAttentionResponse>({
    queryKey: hiddenThreadPendingInteractionAttentionQueryKey(),
    queryFn: ({ signal }) =>
      sdk.threads.experimental_listPendingInteractions({
        visibility: "hidden",
        signal,
      }),
    ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
  });
}
