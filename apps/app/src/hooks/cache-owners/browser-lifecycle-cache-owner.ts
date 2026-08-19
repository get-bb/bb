import type { Query, QueryClient } from "@tanstack/react-query";

/**
 * Suspend/resume pair for the browser lifecycle. On suspend, in-flight fetches
 * are cancelled (with revert) so a mobile page freeze cannot fail them; the
 * cancelled queries are remembered so the resume can pick them back up.
 * Cancelling reverts a first load to `pending`/`idle` with no data, and a
 * query with `refetchOnWindowFocus: false` (the realtime-owned policies) has
 * nothing else that restarts it: no focus refetch, no realtime change for it,
 * and no reconnect wave when the socket stayed healthy. Left alone it would
 * sit on its loading state until the next mount.
 */
export interface BrowserLifecycleFetchController {
  suspend: () => void;
  resume: () => void;
}

export function createBrowserLifecycleFetchController(
  queryClient: QueryClient,
): BrowserLifecycleFetchController {
  let cancelledOnSuspend = new Set<Query>();
  return {
    suspend: () => {
      for (const query of queryClient
        .getQueryCache()
        .findAll({ fetchStatus: "fetching", type: "active" })) {
        cancelledOnSuspend.add(query);
      }
      void queryClient.cancelQueries({
        fetchStatus: "fetching",
        type: "active",
      });
    },
    resume: () => {
      if (cancelledOnSuspend.size === 0) {
        return;
      }
      const cancelled = cancelledOnSuspend;
      cancelledOnSuspend = new Set<Query>();
      // Only the fetches this controller aborted, and only if nothing else
      // (focus refetch, realtime flush) has already restarted them.
      void queryClient.refetchQueries(
        {
          predicate: (query) => cancelled.has(query),
          type: "active",
        },
        { cancelRefetch: false },
      );
    },
  };
}
