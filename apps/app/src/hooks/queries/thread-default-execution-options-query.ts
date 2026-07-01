import { useQuery } from "@tanstack/react-query";
import type { ResolvedThreadExecutionOptions } from "@bb/domain";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";
import { useThreadDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { requireEnabledQueryArg } from "./query-helpers";
import { threadDefaultExecutionOptionsQueryKey } from "./query-keys";
import { REALTIME_OWNED_NO_FOCUS_QUERY_POLICY } from "./query-policies";

export {
  allThreadDefaultExecutionOptionsQueryKeyPrefix,
  threadDefaultExecutionOptionsQueryKey,
} from "./query-keys";
export type {
  ThreadDefaultExecutionOptionsQueryKey,
  ThreadDefaultExecutionOptionsQueryKeyPrefix,
} from "./query-keys";

interface ThreadDefaultExecutionOptionsQueryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
}

function requireThreadId(id: string, hookName: string): string {
  return requireEnabledQueryArg({ value: id, hookName, argName: "thread id" });
}

export function fetchThreadDefaultExecutionOptions(
  threadId: string,
  signal?: AbortSignal,
): Promise<ResolvedThreadExecutionOptions | null> {
  return request<ResolvedThreadExecutionOptions | null>(
    apiClient.threads[":id"]["default-execution-options"].$get(
      {
        param: { id: threadId },
      },
      requestOptions(signal),
    ),
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
    queryFn: ({ signal }) =>
      fetchThreadDefaultExecutionOptions(
        requireThreadId(id, "useThreadDefaultExecutionOptions"),
        signal,
      ),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
    staleTime: options?.staleTime,
  });
}
