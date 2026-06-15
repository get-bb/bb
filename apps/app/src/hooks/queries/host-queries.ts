import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import * as api from "@/lib/api";
import { hostsQueryKey } from "./query-keys";

interface QueryOptions {
  enabled?: boolean;
}

/**
 * Hosts known to the server, with live connection status. Server-derived, so it
 * resolves from any device on the tailnet — unlike the loopback host-daemon
 * probe, which only answers on the machine actually running bb.
 */
export function useHosts(options?: QueryOptions) {
  return useQuery<Host[]>({
    queryKey: hostsQueryKey(),
    queryFn: () => api.listHosts(),
    enabled: options?.enabled ?? true,
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
