import type { QueryClient } from "@tanstack/react-query";
import type { Draft } from "@bb/server-contract";
import { draftResourceQueryKey } from "@/lib/drafts/resource-api";
import { allDraftQueryKeyPrefix } from "../queries/query-keys";

export async function cacheDraftResource(
  queryClient: QueryClient,
  id: string,
  draft: Draft | null,
): Promise<boolean> {
  const queryKey = draftResourceQueryKey(id);
  await queryClient.cancelQueries({ queryKey, exact: true });
  const current = queryClient.getQueryData<Draft | null>(queryKey);
  if (draft && current && current.revision > draft.revision) return false;
  queryClient.setQueryData<Draft | null>(queryKey, draft);
  return true;
}

export function invalidateDraftLists(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: allDraftQueryKeyPrefix(),
    predicate: (query) => query.queryKey[1] !== "detail",
  });
}

export function invalidateDraftResources(
  queryClient: QueryClient,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: allDraftQueryKeyPrefix() });
}
