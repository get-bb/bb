import { useQuery } from "@tanstack/react-query";
import type { ResolvedThreadExecutionOptions } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import {
  readCachedThreadExecutionOptions,
  threadExecutionOptionsCacheKey,
  writeCachedThreadExecutionOptions,
} from "@/lib/thread-execution-options-cache";
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

export async function fetchThreadDefaultExecutionOptions(
  threadId: string,
  signal?: AbortSignal,
): Promise<ResolvedThreadExecutionOptions | null> {
  const options = await sdk.threads.defaultExecutionOptions({
    threadId,
    signal,
  });
  // Remember a real resolution so the next mount of this thread paints it
  // immediately. Null means the server could not resolve options; there is
  // nothing worth replaying then.
  if (options !== null) {
    writeCachedThreadExecutionOptions(
      threadExecutionOptionsCacheKey(threadId),
      options,
    );
  }
  return options;
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
    // Composers read model/reasoning/permission defaults from this query, so
    // a full page load otherwise paints neutral defaults for a beat and then
    // snaps to the thread's real settings. Replay the last resolution as
    // placeholder data; consumers keep submission gated on `isPlaceholderData`
    // so nothing runs on a stale replay.
    placeholderData: () =>
      id
        ? (readCachedThreadExecutionOptions(
            threadExecutionOptionsCacheKey(id),
          ) ?? undefined)
        : undefined,
  });
}
