import type { PendingInteraction } from "@bb/domain";
import type { ThreadPendingInteractionsResponse } from "@bb/server-contract";
import type { QueryClient } from "@tanstack/react-query";
import {
  sidebarNavigationQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKeyPrefix,
} from "@/lib/query/query-keys";
import { applyToCachedThreadListsAndSidebar } from "../threads/thread-list-cache";

/**
 * Cache effects of resolving / responding to / cancelling a pending
 * interaction (mirrors `invalidateThreadPendingInteractionResolutionQueries`
 * in apps/app/src/hooks/cache-owners/mutation-cache-effects.ts, plus an
 * eager write of the server's returned interaction so the banner reflects
 * `resolving` / disappearance before the realtime `interactions-changed`
 * refetch lands).
 */

function isStillListed(interaction: PendingInteraction): boolean {
  // `GET /threads/:id/interactions` lists pending + resolving only.
  return interaction.status === "pending" || interaction.status === "resolving";
}

/** Write the interaction the resolve/respond/cancel route returned. */
export function applyInteractionResult(
  queryClient: QueryClient,
  interaction: PendingInteraction,
): void {
  queryClient.setQueryData<ThreadPendingInteractionsResponse>(
    threadPendingInteractionsQueryKey(interaction.threadId),
    (current) => {
      if (!current) return current;
      const listed = isStillListed(interaction);
      const index = current.findIndex(
        (candidate) => candidate.id === interaction.id,
      );
      if (index === -1) return listed ? [...current, interaction] : current;
      if (!listed) {
        return current.filter((candidate) => candidate.id !== interaction.id);
      }
      const next = [...current];
      next[index] = interaction;
      return next;
    },
  );
  if (!isStillListed(interaction)) {
    const threadId = interaction.threadId;
    const stillHasPending =
      (
        queryClient.getQueryData<ThreadPendingInteractionsResponse>(
          threadPendingInteractionsQueryKey(threadId),
        ) ?? []
      ).length > 0;
    if (!stillHasPending) {
      applyToCachedThreadListsAndSidebar(queryClient, (list) =>
        list.some((entry) => entry.id === threadId)
          ? list.map((entry) =>
              entry.id === threadId
                ? { ...entry, hasPendingInteraction: false }
                : entry,
            )
          : list,
      );
    }
  }
}

/** Let the server settle the interaction list, timeline, thread, and lists. */
export function invalidateInteractionResolution(
  queryClient: QueryClient,
  threadId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: threadPendingInteractionsQueryKey(threadId),
  });
  void queryClient.invalidateQueries({
    queryKey: threadTimelineQueryKey(threadId),
  });
  void queryClient.invalidateQueries({
    queryKey: threadTimelineTurnSummaryDetailsQueryKeyPrefix(threadId),
  });
  void queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  void queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  void queryClient.invalidateQueries({
    queryKey: threadSearchQueryKeyPrefix(),
  });
}
