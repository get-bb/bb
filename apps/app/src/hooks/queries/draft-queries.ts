import { useInfiniteQuery } from "@tanstack/react-query";
import type { DraftListQuery } from "@bb/server-contract";
import {
  draftResourceListQueryKey,
  listDraftResources,
} from "@/lib/drafts/resource-api";

const DRAFTS_PAGE_SIZE = 50;

export function useDrafts(
  query: Omit<DraftListQuery, "offset"> = {},
  options?: { enabled?: boolean },
) {
  const filters = { limit: String(DRAFTS_PAGE_SIZE), ...query };
  return useInfiniteQuery({
    queryKey: draftResourceListQueryKey(filters),
    queryFn: ({ pageParam, signal }) =>
      listDraftResources({ ...filters, offset: String(pageParam) }, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: options?.enabled ?? true,
    staleTime: 10_000,
  });
}
