import { useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { useSystemRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { serverMoveStatusQueryKey } from "./query-keys";
import type { QueryOptions } from "./query-helpers";
import { FOCUS_OWNED_LIVE_QUERY_POLICY } from "./query-policies";

export function useServerMoveStatus(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  return useQuery({
    queryKey: serverMoveStatusQueryKey(),
    queryFn: ({ signal }) => sdk.experimental_server.moveStatus({ signal }),
    enabled,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });
}

export function useServerMoveStatusPolling(intervalMs: number | null): void {
  useQuery({
    queryKey: serverMoveStatusQueryKey(),
    queryFn: ({ signal }) => sdk.experimental_server.moveStatus({ signal }),
    enabled: intervalMs !== null,
    refetchInterval: intervalMs ?? false,
    retry: false,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });
}
