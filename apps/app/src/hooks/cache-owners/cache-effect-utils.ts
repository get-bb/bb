import type { QueryClient, QueryKey, Updater } from "@tanstack/react-query";
import type { QueryKeysArg } from "../cache-effect-types";

export function invalidateQueryKeys({
  queryClient,
  queryKeys,
}: QueryKeysArg): void {
  for (const queryKey of queryKeys) {
    queryClient.invalidateQueries({ queryKey });
  }
}

export function refetchFailedActiveQueryKeys({
  queryClient,
  queryKeys,
}: QueryKeysArg): void {
  for (const queryKey of queryKeys) {
    void queryClient
      .refetchQueries({
        queryKey,
        type: "active",
        predicate: (query) =>
          query.state.status === "error" && query.state.fetchStatus === "idle",
      })
      .catch(() => {});
  }
}

export function patchCachedQueryData<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  updater: Updater<T | undefined, T | undefined>,
): void {
  const fetchedAt = queryClient.getQueryState<T>(queryKey)?.dataUpdatedAt;
  queryClient.setQueryData<T>(
    queryKey,
    updater,
    fetchedAt ? { updatedAt: fetchedAt } : undefined,
  );
}

export function keepNewerByUpdatedAt<T extends { updatedAt: number }>(
  cached: T | undefined,
  incoming: T,
): T {
  return cached !== undefined && cached.updatedAt > incoming.updatedAt
    ? cached
    : incoming;
}

export function setQueryDataOverInFlightFetch<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  updater: Updater<T | undefined, T | undefined>,
): void {
  const fetchStatus =
    queryClient.getQueryState(queryKey)?.fetchStatus ?? "idle";
  queryClient.setQueryData<T>(queryKey, updater);
  if (fetchStatus === "idle") return;
  void queryClient.cancelQueries({ queryKey, exact: true });
  void queryClient.invalidateQueries({ queryKey, exact: true });
}
