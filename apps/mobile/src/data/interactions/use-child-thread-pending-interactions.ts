import type { PendingInteraction } from "@bb/domain";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { threadPendingInteractionsQueryKey } from "@/lib/query/query-keys";
import { REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY } from "../shared/query-policies";
import {
  collectChildThreadPendingAttention,
  pendingChildThreadIds,
  type ChildThreadPendingAttention,
  type ChildThreadPendingAttentionSource,
} from "./child-thread-pending-interactions";

type InteractionsByThreadId = ReadonlyMap<
  string,
  readonly PendingInteraction[] | undefined
>;

/**
 * Latest pending interaction of every child that reports one (mirrors
 * apps/app/src/hooks/queries/child-thread-pending-interactions.ts). The
 * thread-list realtime stream already flips `hasPendingInteraction`, and
 * resolving from the parent invalidates the child's interaction query, so no
 * per-child `thread-detail` subscription is held.
 */
export function useChildThreadPendingInteractions(
  children: readonly ChildThreadPendingAttentionSource[],
): ChildThreadPendingAttention[] {
  const { sdk } = useProfileClient();
  const pendingIds = useMemo(() => pendingChildThreadIds(children), [children]);

  // `combine` is memoized by TanStack on the results + its own identity, so
  // the map only changes when a child's interaction list does.
  const combine = useCallback(
    (
      results: UseQueryResult<readonly PendingInteraction[]>[],
    ): InteractionsByThreadId => {
      const next = new Map<string, readonly PendingInteraction[] | undefined>();
      pendingIds.forEach((threadId, index) => {
        next.set(threadId, results[index]?.data);
      });
      return next;
    },
    [pendingIds],
  );

  const interactionsByThreadId = useQueries({
    queries: pendingIds.map((threadId) => ({
      queryKey: threadPendingInteractionsQueryKey(threadId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdk.threads.interactions.list({ threadId, signal }),
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    })),
    combine,
  });

  return useMemo(
    () => collectChildThreadPendingAttention(children, interactionsByThreadId),
    [children, interactionsByThreadId],
  );
}
