import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import type { HostDirectoryListing } from "@bb/server-contract";
import * as api from "@/lib/api";
import { useHostListRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { hostDirectoryQueryKey, hostsQueryKey } from "./query-keys";

interface QueryOptions {
  enabled?: boolean;
}

/**
 * Hosts known to the server, with live connection status. Server-derived, so it
 * resolves from any device on the tailnet — unlike the loopback host-daemon
 * probe, which only answers on the machine actually running bb.
 */
export function useHosts(options?: QueryOptions) {
  const enabled = options?.enabled ?? true;
  useHostListRealtimeSubscription({ enabled });

  return useQuery<Host[]>({
    queryKey: hostsQueryKey(),
    queryFn: ({ signal }) => api.listHosts(signal),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * The single host the server runs work on. bb is single-host today; if a stale
 * disconnected host lingers alongside a live one, the connected host wins.
 * Returns null while loading or before any host has ever connected.
 */
export function usePrimaryHost(options?: QueryOptions): Host | null {
  const { data: hosts } = useHosts(options);
  return useMemo(() => {
    if (!hosts || hosts.length === 0) return null;
    return hosts.find((host) => host.status === "connected") ?? hosts[0];
  }, [hosts]);
}

/**
 * Single-level directory listing on a host, for the interactive path browser.
 * A null `path` lists the host's home directory. Keeps the previous listing
 * visible while navigating so the list doesn't blank out between folders.
 */
export function useHostDirectory(hostId: string | null, path: string | null) {
  return useQuery<HostDirectoryListing>({
    queryKey: hostDirectoryQueryKey(hostId, path),
    queryFn: ({ signal }) =>
      api.browseHostDirectory({
        hostId: hostId as string,
        ...(path ? { path } : {}),
        signal,
      }),
    enabled: hostId != null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
