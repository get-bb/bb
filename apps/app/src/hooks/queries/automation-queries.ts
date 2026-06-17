import { useQuery } from "@tanstack/react-query";
import type { AutomationsOverviewResponse } from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  useProjectListRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import { automationsQueryKey } from "./query-keys";

interface QueryOptions {
  enabled?: boolean;
}

/**
 * Cross-project automations overview for the Automations view. Subscribes to the
 * project-list realtime channel so `automations-changed` /
 * `automation-runs-changed` notifications invalidate the overview, and to the
 * thread-list channel because rows render the spawning thread's title/state.
 */
export function useAutomations(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<AutomationsOverviewResponse>({
    queryKey: automationsQueryKey(),
    queryFn: ({ signal }) => api.listAutomations(signal),
    enabled,
  });
}
