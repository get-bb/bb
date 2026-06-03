import { useQuery } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import type {
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import * as api from "@/lib/api";
import { fetchProviderCliStatus } from "@/lib/api-host-daemon";
import {
  type HostQueryId,
  hostQueryKey,
  hostsQueryKey,
  localProviderCliStatusQueryKey,
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemVersionQueryKey,
} from "./query-keys";

export interface UseSystemExecutionOptionsArgs {
  enabled?: boolean;
  environmentId?: string;
  providerId?: string;
}

interface QueryOptions {
  enabled?: boolean;
}

function requireQueryId(id: HostQueryId, hookName: string): string {
  if (!id) {
    throw new Error(`${hookName}: hostId is required when query is enabled`);
  }

  return id;
}

function requireDaemonPort(
  daemonPort: number | null,
  hookName: string,
): number {
  if (daemonPort === null) {
    throw new Error(
      `${hookName}: daemonPort is required when query is enabled`,
    );
  }
  return daemonPort;
}

export function useHosts(options?: QueryOptions) {
  return useQuery<Host[]>({
    queryKey: hostsQueryKey(),
    queryFn: () => api.listHosts(),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useHost(hostId: HostQueryId, options?: QueryOptions) {
  return useQuery<Host>({
    queryKey: hostQueryKey(hostId),
    queryFn: () => api.getHost(requireQueryId(hostId, "useHost")),
    enabled: (options?.enabled ?? true) && Boolean(hostId),
    staleTime: 30_000,
  });
}

export function useSystemExecutionOptions(
  args: UseSystemExecutionOptionsArgs = {},
) {
  const environmentId = args.environmentId ?? null;
  const providerId = args.providerId ?? null;

  return useQuery<SystemExecutionOptionsResponse>({
    queryKey: systemExecutionOptionsQueryKey({ environmentId, providerId }),
    queryFn: () =>
      api.getSystemExecutionOptions({
        environmentId: args.environmentId,
        providerId: args.providerId,
      }),
    enabled: args.enabled ?? true,
    staleTime: 60_000,
  });
}

export function useSystemConfig(options?: QueryOptions) {
  return useQuery<SystemConfigResponse>({
    queryKey: systemConfigQueryKey(),
    queryFn: () => api.getSystemConfig(),
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  });
}

const SYSTEM_VERSION_STALE_TIME_MS = 60 * 60 * 1000;

export function useSystemVersion(options?: QueryOptions) {
  return useQuery<SystemVersionResponse>({
    queryKey: systemVersionQueryKey(),
    queryFn: () => api.getSystemVersion(),
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
    queryFn: () =>
      fetchProviderCliStatus(
        requireDaemonPort(daemonPort, "useLocalProviderCliStatus"),
      ),
    enabled: (enabled ?? true) && daemonPort !== null,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}
