import { useEffect, useMemo, useRef } from "react";
import { useSetAtom } from "jotai";
import { isThreadRead } from "@bb/client-core";
import { useRouteState } from "@/hooks/useRouteState";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { mobileRecentsCollapsedThreadIdsAtom } from "./mobile-recents-collapse";

export function useMobileRecentsThreadReveal(): void {
  const { threadId: selectedThreadId } = useRouteState();
  const { data: navigation, isPlaceholderData } = useSidebarNavigation();
  const setCollapsedThreadIds = useSetAtom(mobileRecentsCollapsedThreadIdsAtom);
  const threads = useMemo(
    () => (navigation ? listSidebarNavigationThreads(navigation) : []),
    [navigation],
  );
  const previousThreadId = useRef<string | undefined>(undefined);
  const pendingNavigation = useRef<string | undefined>(undefined);
  const previousUnreadIds = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (previousThreadId.current !== selectedThreadId) {
      previousThreadId.current = selectedThreadId;
      pendingNavigation.current = selectedThreadId;
    }
    if (!navigation || isPlaceholderData) return;
    const threadById = new Map(threads.map((thread) => [thread.id, thread]));
    const revealIds = new Set<string>();
    if (
      pendingNavigation.current &&
      threadById.has(pendingNavigation.current)
    ) {
      revealIds.add(pendingNavigation.current);
      pendingNavigation.current = undefined;
    }
    const unreadIds = new Set<string>();
    for (const thread of threads) {
      if (thread.visibility === "hidden" || isThreadRead(thread)) continue;
      unreadIds.add(thread.id);
      if (
        previousUnreadIds.current &&
        !previousUnreadIds.current.has(thread.id) &&
        thread.id !== selectedThreadId
      ) {
        revealIds.add(thread.id);
      }
    }
    previousUnreadIds.current = unreadIds;

    const ancestorIds = new Set<string>();
    for (const threadId of revealIds) {
      const thread = threadById.get(threadId);
      if (!thread || thread.visibility === "hidden") continue;
      let parentThreadId = thread.parentThreadId;
      while (parentThreadId !== null && !ancestorIds.has(parentThreadId)) {
        const parent = threadById.get(parentThreadId);
        if (!parent) break;
        ancestorIds.add(parent.id);
        parentThreadId = parent.parentThreadId;
      }
    }
    if (ancestorIds.size === 0) return;
    setCollapsedThreadIds((current) => {
      const next = current.filter((id) => !ancestorIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [isPlaceholderData, navigation, selectedThreadId, setCollapsedThreadIds, threads]);
}
