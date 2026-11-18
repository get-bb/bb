import type { Query, QueryClient } from "@tanstack/react-query";
import { HOST_DERIVED_QUERY_META } from "../queries/query-policies";

export const HOST_DERIVED_REFRESH_INTERVAL_MS = 5 * 60_000;

function isHostDerivedQuery(query: Query): boolean {
  return query.meta?.hostDerived === HOST_DERIVED_QUERY_META.hostDerived;
}

export function refreshStaleHostDerivedState(
  queryClient: QueryClient,
): Promise<void> {
  return queryClient.refetchQueries(
    { predicate: isHostDerivedQuery, stale: true, type: "active" },
    { cancelRefetch: false },
  );
}

export function invalidateHostDerivedState(
  queryClient: QueryClient,
): Promise<void> {
  return queryClient.invalidateQueries(
    { predicate: isHostDerivedQuery },
    { cancelRefetch: false },
  );
}

export function installHostDerivedStateRefresh(queryClient: QueryClient): {
  cleanup: () => void;
} {
  const refreshWhenVisible = () => {
    if (document.visibilityState !== "visible") return;
    void refreshStaleHostDerivedState(queryClient);
  };
  const interval = window.setInterval(
    refreshWhenVisible,
    HOST_DERIVED_REFRESH_INTERVAL_MS,
  );
  window.addEventListener("focus", refreshWhenVisible, false);
  window.addEventListener("pageshow", refreshWhenVisible, false);
  document.addEventListener("visibilitychange", refreshWhenVisible, false);
  return {
    cleanup: () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    },
  };
}
