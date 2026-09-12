import type { SystemConfigResponse } from "@bb/server-contract";
import { useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { systemConfigQueryKey } from "@/lib/query/query-keys";
import { useSystemRealtimeSubscription } from "../shared/use-realtime-subscription";

export function useSystemConfig() {
  const { sdk } = useProfileClient();
  useSystemRealtimeSubscription();
  return useQuery<SystemConfigResponse>({
    queryKey: systemConfigQueryKey(),
    queryFn: ({ signal }) => sdk.system.config({ signal }),
    staleTime: 60_000,
  });
}
