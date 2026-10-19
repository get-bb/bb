import type {
  Mutation,
  Query,
  QueryClient,
  QueryFilters,
} from "@tanstack/react-query";

const recoveries = new WeakMap<QueryClient, Map<Query, Set<Mutation>>>();

function pendingRecoveries(
  queryClient: QueryClient,
): Map<Query, Set<Mutation>> {
  const existing = recoveries.get(queryClient);
  if (existing) return existing;

  const pending = new Map<Query, Set<Mutation>>();
  recoveries.set(queryClient, pending);
  const cleanup = () => {
    if (pending.size > 0) return;
    unsubscribeMutations();
    unsubscribeQueries();
    recoveries.delete(queryClient);
  };
  const unsubscribeMutations = queryClient
    .getMutationCache()
    .subscribe((event) => {
      if (event.type !== "updated" && event.type !== "removed") return;
      if (event.type === "updated" && event.mutation.state.status === "pending")
        return;
      const ready = new Set<Query>();
      for (const [query, mutations] of pending) {
        mutations.delete(event.mutation);
        if (mutations.size === 0) {
          pending.delete(query);
          ready.add(query);
        }
      }
      cleanup();
      if (ready.size > 0) {
        void queryClient.invalidateQueries({
          predicate: (query) => ready.has(query),
        });
      }
    });
  const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "removed") return;
    pending.delete(event.query);
    cleanup();
  });
  return pending;
}

export function cancelOptimisticQueries(
  queryClient: QueryClient,
  filters: QueryFilters,
): Promise<void> {
  const mutations = queryClient
    .getMutationCache()
    .findAll({ status: "pending" });
  if (mutations.length > 0) {
    for (const query of queryClient.getQueryCache().findAll(filters)) {
      const existing = recoveries.get(queryClient)?.get(query);
      if (query.state.fetchStatus === "idle" && !existing) continue;
      const pending = pendingRecoveries(queryClient);
      const blockers = existing ?? new Set<Mutation>();
      for (const mutation of mutations) blockers.add(mutation);
      pending.set(query, blockers);
    }
  }
  return queryClient.cancelQueries(filters);
}
