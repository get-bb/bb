import { useQuery } from "@tanstack/react-query";
import type { SystemAppUpdateStatus } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { useSystemRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { systemAppUpdateQueryKey } from "./query-keys";
import type { QueryOptions } from "./query-helpers";
import { FOCUS_OWNED_LIVE_QUERY_POLICY } from "./query-policies";

const ACTIVE_UPDATE_POLL_INTERVAL_MS = 1_000;

export function useAppUpdateStatus(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  return useQuery<SystemAppUpdateStatus>({
    queryKey: systemAppUpdateQueryKey(),
    queryFn: ({ signal }) => sdk.system.appUpdate({ signal }),
    enabled,
    refetchInterval: (query) =>
      query.state.data !== undefined &&
      query.state.data.activity.phase !== "idle"
        ? ACTIVE_UPDATE_POLL_INTERVAL_MS
        : false,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });
}
