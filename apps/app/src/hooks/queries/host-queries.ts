import { useMemo } from "react";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import type { HostDirectoryListing } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { useHostListRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  hostCloneDefaultPathQueryKey,
  hostDirectoryQueryKey,
  hostsQueryKey,
} from "./query-keys";
import type { QueryOptions } from "./query-helpers";

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
    queryFn: ({ signal }) => sdk.hosts.list({ signal }),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * The host bb defaults work to. The server-resolved `primaryHostId` from
 * `/system/config` is authoritative — with several connected machines the
 * first-connected guess can crown the wrong one. The connected-first
 * heuristic remains only for a null id (fresh server, or config still
 * loading). A non-null id that isn't in the list means the primary isn't
 * visible here: return null rather than promote another machine.
 */
export function selectPrimaryHost(
  hosts: readonly Host[] | undefined,
  primaryHostId: string | null,
): Host | null {
  if (!hosts || hosts.length === 0) return null;
  if (primaryHostId !== null) {
    return hosts.find((host) => host.id === primaryHostId) ?? null;
  }
  return hosts.find((host) => host.status === "connected") ?? hosts[0] ?? null;
}

/**
 * The single host the server runs work on by default, resolved server-side.
 * Returns null while loading or before any host has ever connected.
 */
export function usePrimaryHost(options?: QueryOptions): Host | null {
  const { data: hosts } = useHosts(options);
  const primaryHostId = useSystemConfig(options).data?.primaryHostId ?? null;
  return useMemo(
    () => selectPrimaryHost(hosts, primaryHostId),
    [hosts, primaryHostId],
  );
}

/**
 * Single-level directory listing on a host, for the interactive path browser.
 * A null `path` lists the host's home directory. Keeps the previous listing
 * visible while navigating so the list doesn't blank out between folders.
 */
/**
 * Default clone destination for a project on a host (the daemon's checkout
 * convention). Discovery only — nothing is created until the clone runs.
 */
export function useHostCloneDefaultPath(
  hostId: string | null,
  projectId: string | null,
  options?: QueryOptions,
) {
  const enabled = options?.enabled ?? true;
  return useQuery<string>({
    queryKey: hostCloneDefaultPathQueryKey(hostId, projectId),
    queryFn:
      enabled && hostId !== null && projectId !== null
        ? async ({ signal }) =>
            (await sdk.hosts.cloneDefaultPath({ hostId, projectId, signal }))
              .path
        : skipToken,
    staleTime: 60_000,
  });
}

export function useHostDirectory(hostId: string | null, path: string | null) {
  return useQuery<HostDirectoryListing>({
    queryKey: hostDirectoryQueryKey(hostId, path),
    queryFn: ({ signal }) =>
      sdk.hosts.directory({
        hostId: hostId as string,
        ...(path ? { path } : {}),
        signal,
      }),
    enabled: hostId != null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
