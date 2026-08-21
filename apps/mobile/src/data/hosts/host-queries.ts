import type { Host } from "@bb/domain";
import type {
  HostDirectoryListing,
  HostProviderCliStatusResponse,
} from "@bb/server-contract";
import {
  keepPreviousData,
  skipToken,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  hostCloneDefaultPathQueryKey,
  hostDirectoryQueryKey,
  hostProviderCliStatusQueryKey,
  hostsQueryKey,
  serverProtocolVersionQueryKey,
} from "@/lib/query/query-keys";
import {
  SERVER_SESSION_QUERY_POLICY,
  SESSION_STATIC_QUERY_POLICY,
} from "../shared/query-policies";
import { useHostListRealtimeSubscription } from "../shared/use-realtime-subscription";
import { useSystemConfig } from "../system/system-queries";
import { selectPrimaryHost } from "./select-primary-host";
import { fetchServerProtocolVersion } from "./server-protocol-version";

interface QueryOptions {
  enabled?: boolean;
}

/** Hosts known to the server with live connection status (`GET /hosts`). */
export function useHosts(options?: QueryOptions) {
  const { sdk } = useProfileClient();
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
 * The server's daemon protocol version (`GET /install/version`, see
 * `fetchServerProtocolVersion`). Null until the server has answered or while
 * the read fails; callers render the stranded-daemon status without the
 * number and hide the retry action rather than compare against a guess. A
 * server restart drops the realtime socket and the reconnect catch-up
 * refetches it.
 */
export function useServerProtocolVersion(
  options?: QueryOptions,
): number | null {
  const client = useProfileClient();
  const query = useQuery<number>({
    queryKey: serverProtocolVersionQueryKey(),
    queryFn: ({ signal }) => fetchServerProtocolVersion(client, signal),
    enabled: options?.enabled ?? true,
    ...SERVER_SESSION_QUERY_POLICY,
  });
  return query.data ?? null;
}

/** Null while loading or before any host has ever connected. */
export function usePrimaryHost(options?: QueryOptions): Host | null {
  const { data: hosts } = useHosts(options);
  const primaryHostId = useSystemConfig(options).data?.primaryHostId ?? null;
  return useMemo(
    () => selectPrimaryHost(hosts, primaryHostId),
    [hosts, primaryHostId],
  );
}

/**
 * Single-level directory listing on a host (`GET /hosts/:id/directory`) for
 * the remote path browser. A null `path` lists the host's home directory.
 * The previous listing stays visible while navigating between folders.
 */
export function useHostDirectory(hostId: string | null, path: string | null) {
  const { sdk } = useProfileClient();
  return useQuery<HostDirectoryListing>({
    queryKey: hostDirectoryQueryKey(hostId, path),
    queryFn:
      hostId === null
        ? skipToken
        : ({ signal }) =>
            sdk.hosts.directory({
              hostId,
              ...(path ? { path } : {}),
              signal,
            }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * Default clone destination for a project on a host (the daemon's checkout
 * convention, `GET /hosts/:id/clone-default-path`). Discovery only.
 */
export function useHostCloneDefaultPath(
  hostId: string | null,
  projectId: string | null,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
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

/**
 * Provider CLI inventory of one connected machine
 * (`GET /hosts/:id/provider-clis/status`, a daemon RPC). Session-static: the
 * Updates screen's explicit check and a finished install invalidate it.
 */
export function useHostProviderCliStatus(
  hostId: string | null,
  options?: QueryOptions,
) {
  const { sdk } = useProfileClient();
  const enabled = (options?.enabled ?? true) && hostId !== null;
  return useQuery<HostProviderCliStatusResponse>({
    queryKey: hostProviderCliStatusQueryKey(hostId ?? ""),
    queryFn:
      hostId === null
        ? skipToken
        : ({ signal }) => sdk.hosts.providerCliStatus({ hostId, signal }),
    enabled,
    ...SESSION_STATIC_QUERY_POLICY,
  });
}

export interface HostProviderCliStatusEntry {
  hostId: string;
  data: HostProviderCliStatusResponse | undefined;
  isPending: boolean;
  isError: boolean;
  dataUpdatedAt: number;
}

/** The provider CLI inventory of several machines at once (the Updates screen). */
export function useHostsProviderCliStatus(
  hostIds: readonly string[],
  options?: QueryOptions,
): HostProviderCliStatusEntry[] {
  const { sdk } = useProfileClient();
  const enabled = options?.enabled ?? true;
  return useQueries({
    queries: hostIds.map((hostId) => ({
      queryKey: hostProviderCliStatusQueryKey(hostId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdk.hosts.providerCliStatus({ hostId, signal }),
      enabled,
      ...SESSION_STATIC_QUERY_POLICY,
    })),
    combine: (results) =>
      results.map((result, index) => ({
        hostId: hostIds[index] ?? "",
        data: result.data,
        isPending: result.isPending,
        isError: result.isError,
        dataUpdatedAt: result.dataUpdatedAt,
      })),
  });
}
