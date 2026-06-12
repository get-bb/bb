import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { ThreadComposerBootstrapResponse } from "@bb/server-contract";
import { apiClient } from "@/lib/api-server";
import { request } from "@/lib/api";
import { hydrateThreadComposerBootstrap } from "../cache-owners/composer-cache-owner";
import { requireEnabledQueryArg } from "./query-helpers";

export const THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY = "threadComposerBootstrap";

export type ThreadComposerBootstrapQueryKey = readonly [
  typeof THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY,
  string | null,
  string,
];
export type ThreadComposerBootstrapEnvironmentQueryKeyPrefix = readonly [
  typeof THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY,
  string | null,
];

interface ThreadComposerBootstrapQueryOptions {
  enabled?: boolean;
  environmentId?: string;
  providerId?: string;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
}

interface FetchAndHydrateThreadComposerBootstrapArgs {
  environmentId: string | null;
  providerId: string | null;
  queryClient: QueryClient;
  threadId: string;
}

const THREAD_COMPOSER_BOOTSTRAP_STALE_TIME_MS = 10_000;
const THREAD_COMPOSER_BOOTSTRAP_GC_TIME_MS = 30_000;

function requireThreadId(id: string, hookName: string): string {
  return requireEnabledQueryArg({ value: id, hookName, argName: "thread id" });
}

export function threadComposerBootstrapQueryKey(
  threadId: string,
  environmentId: string | null,
): ThreadComposerBootstrapQueryKey {
  return [THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY, environmentId, threadId];
}

export function threadComposerBootstrapEnvironmentQueryKeyPrefix(
  environmentId: string | null,
): ThreadComposerBootstrapEnvironmentQueryKeyPrefix {
  return [THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY, environmentId];
}

export function fetchThreadComposerBootstrap(
  threadId: string,
): Promise<ThreadComposerBootstrapResponse> {
  return request<ThreadComposerBootstrapResponse>(
    apiClient.threads[":id"]["composer-bootstrap"].$get({
      param: { id: threadId },
    }),
  );
}

export async function fetchAndHydrateThreadComposerBootstrap({
  environmentId,
  providerId,
  queryClient,
  threadId,
}: FetchAndHydrateThreadComposerBootstrapArgs): Promise<ThreadComposerBootstrapResponse> {
  const bootstrap = await fetchThreadComposerBootstrap(threadId);
  hydrateThreadComposerBootstrap({
    bootstrap,
    environmentId,
    providerId,
    queryClient,
    threadId,
  });
  return bootstrap;
}

export function useThreadComposerBootstrap(
  id: string,
  options?: ThreadComposerBootstrapQueryOptions,
) {
  const queryClient = useQueryClient();
  const environmentId = options?.environmentId ?? null;
  const providerId = options?.providerId ?? null;

  return useQuery<ThreadComposerBootstrapResponse>({
    queryKey: threadComposerBootstrapQueryKey(id, environmentId),
    queryFn: () =>
      fetchAndHydrateThreadComposerBootstrap({
        environmentId,
        providerId,
        queryClient,
        threadId: requireThreadId(id, "useThreadComposerBootstrap"),
      }),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    staleTime: options?.staleTime ?? THREAD_COMPOSER_BOOTSTRAP_STALE_TIME_MS,
    gcTime: THREAD_COMPOSER_BOOTSTRAP_GC_TIME_MS,
  });
}
