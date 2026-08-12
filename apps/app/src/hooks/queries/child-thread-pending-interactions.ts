import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { PendingInteraction } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { REALTIME_OWNED_NO_FOCUS_QUERY_POLICY } from "./query-policies";
import { threadPendingInteractionsQueryKey } from "./query-keys";
import { getLatestPendingInteraction } from "./thread-queries";

export interface ChildThreadPendingAttentionSource {
  hasPendingInteraction: boolean;
  href: string;
  id: string;
  title: string;
}

export interface ChildThreadPendingAttention {
  childThreadId: string;
  childTitle: string;
  href: string;
  interaction: PendingInteraction;
}

export function collectChildThreadPendingAttention(
  children: readonly ChildThreadPendingAttentionSource[],
  interactionsByThreadId: ReadonlyMap<
    string,
    readonly PendingInteraction[] | undefined
  >,
): ChildThreadPendingAttention[] {
  const items: ChildThreadPendingAttention[] = [];
  for (const child of children) {
    if (!child.hasPendingInteraction) {
      continue;
    }
    const interaction = getLatestPendingInteraction(
      interactionsByThreadId.get(child.id),
    );
    if (!interaction) {
      continue;
    }
    items.push({
      childThreadId: child.id,
      childTitle: child.title,
      href: child.href,
      interaction,
    });
  }
  return items;
}

export function useChildThreadPendingAttention(
  children: readonly ChildThreadPendingAttentionSource[],
): ChildThreadPendingAttention[] {
  // Thread-list realtime already flips `hasPendingInteraction`. Resolving
  // from the parent invalidates the interaction query. Do not subscribe to
  // each child detail stream.
  const pendingChildIds = useMemo(
    () =>
      children
        .filter((child) => child.hasPendingInteraction)
        .map((child) => child.id),
    [children],
  );

  const queries = useQueries({
    queries: pendingChildIds.map((threadId) => ({
      queryKey: threadPendingInteractionsQueryKey(threadId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdk.threads.interactions.list({
          threadId,
          signal,
        }),
      enabled: true,
      refetchOnMount: true,
      ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
    })),
  });

  const interactionsByThreadId = useMemo(() => {
    const next = new Map<string, readonly PendingInteraction[] | undefined>();
    pendingChildIds.forEach((threadId, index) => {
      next.set(threadId, queries[index]?.data);
    });
    return next;
  }, [pendingChildIds, queries]);

  return useMemo(
    () => collectChildThreadPendingAttention(children, interactionsByThreadId),
    [children, interactionsByThreadId],
  );
}
