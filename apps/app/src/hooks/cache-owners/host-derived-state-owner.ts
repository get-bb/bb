import type { Query, QueryClient } from "@tanstack/react-query";
import { readHostDerivedQueryHostId } from "../queries/query-policies";

export function invalidateHostDerivedState(
  queryClient: QueryClient,
  hostId: string | null,
): Promise<void> {
  return queryClient.invalidateQueries(
    {
      predicate: (query: Query) => {
        const queryHostId = readHostDerivedQueryHostId(query.meta);
        return (
          queryHostId !== undefined &&
          (hostId === null || queryHostId === null || queryHostId === hostId)
        );
      },
    },
    { cancelRefetch: false },
  );
}
