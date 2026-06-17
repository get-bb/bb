import type { QueryClient } from "@tanstack/react-query";
import type { Host, ThreadWithRuntime } from "@bb/domain";
import type {
  ThreadResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { getCachedThreadListPlaceholder } from "./query-cache";
import {
  fetchAndHydrateThreadComposerBootstrap,
  threadComposerBootstrapQueryKey,
} from "../queries/thread-composer-bootstrap-query";
import {
  environmentQueryKey,
  hostQueryKey,
  hostsQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
} from "../queries/query-keys";

type HostList = Host[];
type HostListQueryData = HostList | undefined;

interface UpsertHostListArgs {
  host: Host;
  hosts: HostListQueryData;
}

interface CachedThreadProjectIdArgs {
  queryClient: QueryClient;
  threadId: string;
}

export interface ThreadDetailBootstrapIngestionArgs {
  composerBootstrapPrefetch: boolean;
  queryClient: QueryClient;
  thread: ThreadWithIncludesResponse;
  timelinePrefetch: boolean;
}

function stripThreadIncludes(
  thread: ThreadWithIncludesResponse,
): ThreadResponse {
  const { environment, host, ...threadResponse } = thread;
  return threadResponse;
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
    return host;
  });

  return found ? nextHosts : [...hosts, host];
}

export function ingestThreadDetailBootstrap({
  composerBootstrapPrefetch,
  queryClient,
  thread,
  timelinePrefetch,
}: ThreadDetailBootstrapIngestionArgs): void {
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
    queryClient.setQueryData<HostList>(hostsQueryKey(), (hosts) =>
      upsertHostList({ host, hosts }),
    );
  }

  if (timelinePrefetch) {
    void queryClient.prefetchQuery({
      queryKey: threadTimelineQueryKey(thread.id),
      queryFn: () =>
        api.getThreadTimeline({
          id: thread.id,
        }),
    });
  }

  if (composerBootstrapPrefetch) {
    const environmentId = thread.environmentId ?? null;
    void queryClient.prefetchQuery({
      queryKey: threadComposerBootstrapQueryKey(thread.id, environmentId),
      queryFn: () =>
        fetchAndHydrateThreadComposerBootstrap({
          environmentId,
          providerId: thread.providerId,
          queryClient,
          threadId: thread.id,
        }),
    });
  }
}

export function getCachedThreadProjectId({
  queryClient,
  threadId,
}: CachedThreadProjectIdArgs): string | undefined {
  const thread = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey(threadId),
  );
  return (
    thread?.projectId ??
    getCachedThreadListPlaceholder(queryClient, threadId)?.projectId
  );
}
