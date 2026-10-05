import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type {
  ProjectThreadItem,
  ThreadComparator,
} from "../model/project-thread-groups.js";
import {
  collapseParentThreads,
  createThreadUnreadPredicate,
  groupComparatorByReadStatus,
  foldReadThreads,
  type HeldReadStatus,
  type ThreadUnreadPredicate,
} from "../model/read-status-grouping.js";
import {
  collapsedThreadIdsAtom,
  sidebarGroupByReadStatusAtom,
  sidebarOrganizationModeAtom,
} from "../preferences/atoms.js";
import { ThreadListGroupContext } from "./ThreadListVisibility.js";

const threadsExpandedWhileGroupedAtom = atom<readonly string[]>([]);
const revealedReadSectionsAtom = atom<readonly string[]>([]);
export const ReadStatusGroupingContext =
  createContext<ThreadUnreadPredicate | null>(null);
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
  const isUnread = useMemo(
    () =>
      groupByReadStatus ? createThreadUnreadPredicate(heldReadStatus) : null,
    [groupByReadStatus, heldReadStatus],
  );
  const groupedComparator = useMemo(
    () =>
      isUnread ? groupComparatorByReadStatus(comparator, isUnread) : comparator,
    [comparator, isUnread],
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
    isUnread,
    comparator: groupedComparator,
    collapsedThreadIds,
    toggleThreadCollapsed,
  };
}

export function useReadThreadFold(
  items: readonly ProjectThreadItem[],
  selectedThreadId: string | undefined,
  sectionId?: string,
) {
  const isUnread = useContext(ReadStatusGroupingContext);
  const groupId = useContext(ThreadListGroupContext);
  const organizationMode = useAtomValue(sidebarOrganizationModeAtom);
  const [revealedSections, setRevealedSections] = useAtom(
    revealedReadSectionsAtom,
  );
  const id = sectionId ?? groupId;
  const key = `${organizationMode}:${id}`;
  const folded = useMemo(
    () =>
      foldReadThreads(
        items,
        isUnread,
        id === null || revealedSections.includes(key),
        selectedThreadId,
      ),
    [items, isUnread, id, revealedSections, key, selectedThreadId],
  );
  const revealReadThreads = useCallback(() => {
    setRevealedSections((current) =>
      current.includes(key) ? current : [...current, key],
    );
  }, [key, setRevealedSections]);
  return { ...folded, revealReadThreads };
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
