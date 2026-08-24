import type { Host } from "@bb/domain";
import type {
  ThreadResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import type { QueryClient } from "@tanstack/react-query";
import {
  environmentQueryKey,
  hostQueryKey,
  hostsQueryKey,
  threadQueryKey,
} from "@/lib/query/query-keys";

/**
 * Seeds the per-entity caches from one `GET /threads/:id?include=environment,host`
 * response (mirrors apps/app/src/hooks/cache-owners/thread-detail-cache-owner.ts)
 * so the live `useThread` / environment / host readers render immediately
 * without their own round trip.
 */

function stripThreadIncludes(
  thread: ThreadWithIncludesResponse,
): ThreadResponse {
  const { environment: _environment, host: _host, ...threadResponse } = thread;
  return threadResponse;
}

function upsertHostList(hosts: Host[] | undefined, host: Host): Host[] {
  if (!hosts) return [host];
  let found = false;
  const next = hosts.map((candidate) => {
    if (candidate.id !== host.id) return candidate;
    found = true;
    return host;
  });
  return found ? next : [...hosts, host];
}

export function ingestThreadDetailBootstrap(
  queryClient: QueryClient,
  thread: ThreadWithIncludesResponse,
): void {
  queryClient.setQueryData(
    threadQueryKey(thread.id),
    stripThreadIncludes(thread),
  );
  if (thread.environment) {
    queryClient.setQueryData(
      environmentQueryKey(thread.environment.id),
      thread.environment,
    );
  }
  if (thread.host) {
    const host = thread.host;
    queryClient.setQueryData(hostQueryKey(host.id), host);
    queryClient.setQueryData<Host[]>(hostsQueryKey(), (hosts) =>
      upsertHostList(hosts, host),
    );
  }
}
