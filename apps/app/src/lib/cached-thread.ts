import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { type Thread, type ThreadListEntry } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import type { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  archivedThreadsListQueryKey,
  sidebarNavigationQueryKey,
  threadQueryKey,
} from "@/hooks/queries/query-keys";
import { threadEntryMapFor } from "./sidebar-thread-entries";

export function lookupCachedThread(
  queryClient: QueryClient,
  threadId: string,
): Thread | null {
  const detail = queryClient.getQueryData<Thread>(threadQueryKey(threadId));
  if (detail !== undefined) return detail;
  const active = threadEntryMapFor(
    queryClient.getQueryData<ReturnType<typeof useSidebarNavigation>["data"]>(
      sidebarNavigationQueryKey(),
    ),
  ).get(threadId);
  if (active !== undefined) return active;
  const archived = queryClient.getQueryData<
    InfiniteData<readonly ThreadListEntry[]>
  >(archivedThreadsListQueryKey({}));
  return (
    archived?.pages.flat().find((thread) => thread.id === threadId) ?? null
  );
}

export async function resolveThread(
  queryClient: QueryClient,
  threadId: string,
): Promise<Thread> {
  return (
    lookupCachedThread(queryClient, threadId) ??
    (await sdk.threads.get({ threadId }))
  );
}
