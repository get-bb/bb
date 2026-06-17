import { useQuery } from "@tanstack/react-query";
import type { ResolvedThreadExecutionOptions } from "@bb/domain";
import { apiClient } from "@/lib/api-server";
import { request } from "@/lib/api";
import { useThreadDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { requireEnabledQueryArg } from "./query-helpers";

export const THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY =
  "threadDefaultExecutionOptions";

export type ThreadDefaultExecutionOptionsQueryKeyPrefix = readonly [
  typeof THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
];
export type ThreadDefaultExecutionOptionsQueryKey = readonly [
  typeof THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  string,
];

interface ThreadDefaultExecutionOptionsQueryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
}

function requireThreadId(id: string, hookName: string): string {
  return requireEnabledQueryArg({ value: id, hookName, argName: "thread id" });
}

export function threadDefaultExecutionOptionsQueryKey(
  threadId: string,
): ThreadDefaultExecutionOptionsQueryKey {
  return [THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY, threadId];
}

export function allThreadDefaultExecutionOptionsQueryKeyPrefix(): ThreadDefaultExecutionOptionsQueryKeyPrefix {
  return [THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY];
}

export function fetchThreadDefaultExecutionOptions(
  threadId: string,
): Promise<ResolvedThreadExecutionOptions | null> {
  return request<ResolvedThreadExecutionOptions | null>(
    apiClient.threads[":id"]["default-execution-options"].$get({
      param: { id: threadId },
    }),
  );
}

export function useThreadDefaultExecutionOptions(
  id: string,
  options?: ThreadDefaultExecutionOptionsQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ResolvedThreadExecutionOptions | null>({
    queryKey: threadDefaultExecutionOptionsQueryKey(id),
    queryFn: () =>
      fetchThreadDefaultExecutionOptions(
        requireThreadId(id, "useThreadDefaultExecutionOptions"),
      ),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: false,
    staleTime: options?.staleTime,
  });
}
