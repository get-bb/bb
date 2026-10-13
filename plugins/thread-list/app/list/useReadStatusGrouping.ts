import { useCallback, useEffect, useMemo, useState } from "react";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { ThreadComparator } from "../model/project-thread-groups.js";
import {
  collapseParentThreads,
  createThreadUnreadPredicate,
  groupComparatorByReadStatus,
  type HeldReadStatus,
} from "../model/read-status-grouping.js";
import {
  collapsedThreadIdsAtom,
  sidebarGroupByReadStatusAtom,
} from "../preferences/atoms.js";

const threadsExpandedWhileGroupedAtom = atom<readonly string[]>([]);
let lastHeldReadStatus: HeldReadStatus | null = null;

export function useHeldReadStatus(
  threads: readonly SidebarThread[],
  selectedThreadId: string | undefined,
): HeldReadStatus | null {
  const [held, setHeld] = useState<HeldReadStatus | null>(() =>
    lastHeldReadStatus?.threadId === selectedThreadId
      ? lastHeldReadStatus
      : null,
  );
  useEffect(() => {
    lastHeldReadStatus = held;
  }, [held]);
  if (held?.threadId === selectedThreadId) {
    return held;
  }
  const thread =
    selectedThreadId === undefined
      ? undefined
      : threads.find((candidate) => candidate.id === selectedThreadId);
  const next = thread
    ? { threadId: thread.id, isUnread: thread.isUnread }
    : null;
  if (next !== null || held !== null) {
    setHeld(next);
  }
  return next;
}

function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id)
    ? ids.filter((current) => current !== id)
    : [...ids, id];
}

export function useReadStatusGrouping({
  threads,
  selectedThreadId,
  comparator,
}: {
  threads: readonly SidebarThread[];
  selectedThreadId: string | undefined;
  comparator: ThreadComparator;
}) {
  const groupByReadStatus = useAtomValue(sidebarGroupByReadStatusAtom);
  const heldReadStatus = useHeldReadStatus(threads, selectedThreadId);
  const [collapsedThreadIdList, setCollapsedThreadIdList] = useAtom(
    collapsedThreadIdsAtom,
  );
  const [expandedWhileGrouped, setExpandedWhileGrouped] = useAtom(
    threadsExpandedWhileGroupedAtom,
  );
  const groupedComparator = useMemo(
    () =>
      groupByReadStatus
        ? groupComparatorByReadStatus(
            comparator,
            createThreadUnreadPredicate(heldReadStatus),
          )
        : comparator,
    [comparator, groupByReadStatus, heldReadStatus],
  );
  const collapsedThreadIds = useMemo(
    () =>
      groupByReadStatus
        ? collapseParentThreads(threads, expandedWhileGrouped)
        : new Set(collapsedThreadIdList),
    [collapsedThreadIdList, expandedWhileGrouped, groupByReadStatus, threads],
  );
  const toggleThreadCollapsed = useCallback(
    (threadId: string) => {
      if (groupByReadStatus) {
        setExpandedWhileGrouped((current) => toggleId(current, threadId));
      } else {
        setCollapsedThreadIdList((current) => toggleId(current, threadId));
      }
    },
    [groupByReadStatus, setCollapsedThreadIdList, setExpandedWhileGrouped],
  );
  return {
    comparator: groupedComparator,
    collapsedThreadIds,
    toggleThreadCollapsed,
  };
}

export function useExpandThreadAncestors() {
  const groupByReadStatus = useAtomValue(sidebarGroupByReadStatusAtom);
  const setCollapsedThreadIdList = useSetAtom(collapsedThreadIdsAtom);
  const setExpandedWhileGrouped = useSetAtom(threadsExpandedWhileGroupedAtom);
  return useCallback(
    (threadIds: ReadonlySet<string>, fromNavigation: boolean) => {
      if (!groupByReadStatus) {
        setCollapsedThreadIdList((current) =>
          current.some((id) => threadIds.has(id))
            ? current.filter((id) => !threadIds.has(id))
            : current,
        );
      } else if (fromNavigation) {
        setExpandedWhileGrouped((current) =>
          [...threadIds].every((id) => current.includes(id))
            ? current
            : [...new Set([...current, ...threadIds])],
        );
      }
    },
    [groupByReadStatus, setCollapsedThreadIdList, setExpandedWhileGrouped],
  );
}
