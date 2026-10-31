import type { QueryClient } from "@tanstack/react-query";
import type { Environment, Host } from "@bb/domain";
import type {
  ThreadResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import {
  environmentQueryKey,
  hostQueryKey,
  hostsQueryKey,
  threadQueryKey,
} from "../queries/query-keys";

type HostList = Host[];
type HostListQueryData = HostList | undefined;

interface UpsertHostListArgs {
  host: Host;
  hosts: HostListQueryData;
}

interface ThreadDetailBootstrapIngestionArgs {
  queryClient: QueryClient;
  thread: ThreadWithIncludesResponse;
}

function stripThreadIncludes(
  thread: ThreadWithIncludesResponse,
): ThreadResponse {
  const { environment, host, ...threadResponse } = thread;
  return threadResponse;
}

function cachedUnlessBootstrapIsNewer<T extends { updatedAt: number }>(
  cached: T | undefined,
  bootstrap: T,
): T {
  return cached !== undefined && cached.updatedAt >= bootstrap.updatedAt
    ? cached
    : bootstrap;
}

function upsertHostList({ host, hosts }: UpsertHostListArgs): HostList {
  if (!hosts) {
    return [host];
  }

  let found = false;
  const nextHosts = hosts.map((candidate) => {
    if (candidate.id !== host.id) {
      return candidate;
    }
    found = true;
    return cachedUnlessBootstrapIsNewer(candidate, host);
  });

  return found ? nextHosts : [...hosts, host];
}

export function ingestThreadDetailBootstrap({
  queryClient,
  thread,
}: ThreadDetailBootstrapIngestionArgs): void {
  queryClient.setQueryData(
    threadQueryKey(thread.id),
    stripThreadIncludes(thread),
  );

  if (thread.environment) {
    const environment = thread.environment;
    queryClient.setQueryData<Environment>(
      environmentQueryKey(environment.id),
      (cached) => cachedUnlessBootstrapIsNewer(cached, environment),
    );
  }

  if (thread.host) {
    const host = thread.host;
    queryClient.setQueryData<Host>(hostQueryKey(host.id), (cached) =>
      cachedUnlessBootstrapIsNewer(cached, host),
    );
    queryClient.setQueryData<HostList>(hostsQueryKey(), (hosts) =>
      upsertHostList({ host, hosts }),
    );
  }
}
