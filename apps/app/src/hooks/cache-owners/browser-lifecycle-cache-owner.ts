import type { QueryClient } from "@tanstack/react-query";

export function cancelActiveQueryFetchesForBrowserSuspend(
  queryClient: QueryClient,
): void {
  void queryClient.cancelQueries({
    fetchStatus: "fetching",
    type: "active",
  });
}
