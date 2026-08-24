import type { QueryClient } from "@tanstack/react-query";

/**
 * A connect desktop-session cookie was just installed (first mint, renewal,
 * re-mint after the gate refused a request). Queries that failed or never
 * loaded hit the gate's 401 page before the cookie existed or while it was
 * stale: they are fetched again, and a first load still in flight without
 * the cookie is cancelled and restarted (it could only come back 401).
 * Queries that already hold data are left alone — the cookie covers their
 * next refetch, and a background refetch in flight keeps going.
 */
export function refetchQueriesRejectedBeforeSession(
  queryClient: QueryClient,
): void {
  void queryClient.invalidateQueries(
    {
      predicate: (query) =>
        query.state.status === "error" || query.state.dataUpdatedAt === 0,
    },
    { cancelRefetch: true },
  );
}
