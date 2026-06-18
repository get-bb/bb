import { useQuery } from "@tanstack/react-query";
import type {
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import * as api from "@/lib/api";
import { fetchProviderCliStatus } from "@/lib/api-host-daemon";
import { useSystemRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  localProviderCliStatusQueryKey,
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemVersionQueryKey,
} from "./query-keys";
import { requireEnabledQueryArg } from "./query-helpers";

export interface UseSystemExecutionOptionsArgs {
  enabled?: boolean;
  environmentId?: string;
  providerId?: string;
}

interface QueryOptions {
  enabled?: boolean;
}

export function useSystemExecutionOptions(
  args: UseSystemExecutionOptionsArgs = {},
) {
  const environmentId = args.environmentId ?? null;
  const providerId = args.providerId ?? null;
  const enabled = args.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });

  return useQuery<SystemExecutionOptionsResponse>({
    queryKey: systemExecutionOptionsQueryKey({ environmentId, providerId }),
    queryFn: ({ signal }) =>
      api.getSystemExecutionOptions({
        environmentId: args.environmentId,
        providerId: args.providerId,
        signal,
      }),
    enabled,
    staleTime: 60_000,
  });
}

export function useSystemConfig(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });

  return useQuery<SystemConfigResponse>({
    queryKey: systemConfigQueryKey(),
    queryFn: ({ signal }) => api.getSystemConfig(signal),
    enabled,
    staleTime: 60_000,
  });
}

const SYSTEM_VERSION_STALE_TIME_MS = 60 * 60 * 1000;

export function useSystemVersion(options?: QueryOptions) {
  return useQuery<SystemVersionResponse>({
    queryKey: systemVersionQueryKey(),
    queryFn: ({ signal }) => api.getSystemVersion(signal),
    enabled: options?.enabled ?? true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: SYSTEM_VERSION_STALE_TIME_MS,
  });
}

export interface UseLocalProviderCliStatusArgs {
  daemonPort: number | null;
  enabled?: boolean;
}

export function useLocalProviderCliStatus({
  daemonPort,
  enabled,
}: UseLocalProviderCliStatusArgs) {
  return useQuery<ProviderCliStatusResponse>({
    queryKey: localProviderCliStatusQueryKey(daemonPort),
    queryFn: ({ signal }) =>
      fetchProviderCliStatus(
        requireEnabledQueryArg({
          value: daemonPort,
          hookName: "useLocalProviderCliStatus",
          argName: "daemonPort",
        }),
        signal,
      ),
    enabled: (enabled ?? true) && daemonPort !== null,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}
