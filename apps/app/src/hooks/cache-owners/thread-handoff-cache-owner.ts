import type { QueryClient } from "@tanstack/react-query";
import type { ThreadHandoffResponse } from "@bb/server-contract";
import { threadHandoffQueryKey } from "../queries/query-keys";

export function setCachedThreadHandoff(
  queryClient: QueryClient,
  result: ThreadHandoffResponse,
): void {
  queryClient.setQueryData(
    threadHandoffQueryKey(result.replacementThreadId),
    result,
  );
}
