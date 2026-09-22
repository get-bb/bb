import { useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import {
  buildPinnedSidebarState,
  CHRONOLOGICAL_CONTAINER_ID,
  isThreadRead,
  NO_MACHINE_GROUP_KEY,
  resolveSidebarProjectId,
  sectionKeyForThreadSection,
  type CollapsibleSidebarSectionId,
} from "@bb/client-core";
import { useBbContext } from "@get-bb/plugin-sdk/app";
import type { OrganizationMode as SidebarOrganizationMode } from "../../shared/preferences.js";
import { useSidebarData } from "../model/use-sidebar-data.js";
import {
  collapsedEnvironmentIdsAtom,
  collapsedProjectIdsAtom,
  collapsedSidebarSectionIdsAtom,
  collapsedThreadIdsAtom,
  sidebarCollapsedMachinesAtom,
  sidebarCollapsedThreadSectionsAtom,
  sidebarOrganizationModeAtom,
} from "../preferences/atoms.js";
import { usePreferencesReady } from "../preferences/PreferencesSync.js";

interface ThreadSidebarExpansionArgs {
  organizationMode: SidebarOrganizationMode;
  isPinned: boolean;
  thread: ThreadListEntry;
  sidebarProjectId: string;
}

interface ThreadSidebarExpansion {
  sectionKey?: string;
  machineKey?: string;
  projectId?: string;
  sidebarSectionId?: CollapsibleSidebarSectionId;
}

function removeCollapsedIds<T extends string>(
  current: T[],
  idsToRemove: ReadonlySet<string>,
): T[] {
  if (idsToRemove.size === 0) {
    return current;
  }
  let removed = false;
  const next = current.filter((id) => {
    if (!idsToRemove.has(id)) {
      return true;
    }
    removed = true;
    return false;
  });
  return removed ? next : current;
}

export function getThreadSidebarExpansion({
  organizationMode,
  isPinned,
  thread,
  sidebarProjectId,
}: ThreadSidebarExpansionArgs): ThreadSidebarExpansion {
  if (isPinned) {
    return { sidebarSectionId: "pinned" };
  }

  if (organizationMode === "machine") {
    return {
      machineKey: thread.environmentHostId ?? NO_MACHINE_GROUP_KEY,
    };
  }

  if (organizationMode === "chronological") {
    const sectionKey = sectionKeyForThreadSection(
      CHRONOLOGICAL_CONTAINER_ID,
      thread.sectionId,
    );
    return sectionKey ? { sectionKey } : { sidebarSectionId: "threads" };
  }

  if (sidebarProjectId === PERSONAL_PROJECT_ID) {
    return { sidebarSectionId: "threads" };
  }

  return { projectId: sidebarProjectId };
}

export function useSidebarThreadReveal(): void {
  const { threadId: routedThreadId } = useBbContext();
  const { status, projects } = useSidebarData();
  const preferencesReady = usePreferencesReady();
  const threads = useMemo<ThreadListEntry[]>(
    () => projects.flatMap((project) => project.threads),
    [projects],
  );
  useSidebarThreadRevealCore({
    selectedThreadId: routedThreadId ?? undefined,
    threads,
    threadsReady: status === "ready",
    preferencesReady,
  });
}

export interface SidebarThreadRevealInputs {
  selectedThreadId: string | undefined;
  threads: readonly ThreadListEntry[];
  threadsReady: boolean;
  preferencesReady: boolean;
}

export function useSidebarThreadRevealCore({
  selectedThreadId,
  threads,
  threadsReady,
  preferencesReady,
}: SidebarThreadRevealInputs): void {
  const organizationMode = useAtomValue(sidebarOrganizationModeAtom);
  const setCollapsedThreadIdList = useSetAtom(collapsedThreadIdsAtom);
  const setCollapsedEnvironmentIdList = useSetAtom(collapsedEnvironmentIdsAtom);
  const setCollapsedProjectIdList = useSetAtom(collapsedProjectIdsAtom);
  const setCollapsedMachineKeyList = useSetAtom(sidebarCollapsedMachinesAtom);
  const setCollapsedSectionList = useSetAtom(
    sidebarCollapsedThreadSectionsAtom,
  );
  const setCollapsedSidebarSectionIdList = useSetAtom(
    collapsedSidebarSectionIdsAtom,
  );
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );
  const effectivePinnedThreadIds = useMemo(
    () => buildPinnedSidebarState({ threads }).effectivePinnedThreadIds,
    [threads],
  );
  const previousThreadId = useRef<string | undefined>(undefined);
  const pendingNavigation = useRef<string | undefined>(undefined);
  const previousUnreadIds = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (previousThreadId.current !== selectedThreadId) {
      previousThreadId.current = selectedThreadId;
      pendingNavigation.current = selectedThreadId;
    }
    if (!preferencesReady || !threadsReady) {
      return;
    }
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
      if (thread.visibility === "hidden" || isThreadRead(thread)) {
        continue;
      }
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
    for (const threadId of revealIds) {
      const thread = threadById.get(threadId);
      if (!thread || thread.visibility === "hidden") {
        continue;
      }
      const threadIdsToExpand = new Set<string>();
      const environmentIdsToExpand = new Set<string>();
      let currentThread: ThreadListEntry | undefined = thread;
      let remainingHops = threadById.size;
      while (currentThread && remainingHops > 0) {
        if (currentThread.environmentId !== null) {
          environmentIdsToExpand.add(currentThread.environmentId);
        }
        const parentThreadId = currentThread.parentThreadId;
        if (parentThreadId === null) {
          break;
        }
        const parentThread = threadById.get(parentThreadId);
        if (!parentThread) {
          break;
        }
        threadIdsToExpand.add(parentThread.id);
        currentThread = parentThread;
        remainingHops -= 1;
      }

      setCollapsedThreadIdList((current) =>
        removeCollapsedIds(current, threadIdsToExpand),
      );
      setCollapsedEnvironmentIdList((current) =>
        removeCollapsedIds(current, environmentIdsToExpand),
      );

      const isPinned = effectivePinnedThreadIds.has(thread.id);
      const expansion = getThreadSidebarExpansion({
        organizationMode,
        isPinned,
        thread,
        sidebarProjectId: resolveSidebarProjectId(thread, threadById),
      });
      if (expansion.machineKey) {
        const machineKey = expansion.machineKey;
        setCollapsedMachineKeyList((current) =>
          removeCollapsedIds(current, new Set([machineKey])),
        );
      }
      if (expansion.sectionKey) {
        const sectionKey = expansion.sectionKey;
        setCollapsedSectionList((current) =>
          removeCollapsedIds(current, new Set([sectionKey])),
        );
      }
      if (expansion.projectId) {
        const projectId = expansion.projectId;
        setCollapsedProjectIdList((current) =>
          removeCollapsedIds(current, new Set([projectId])),
        );
      }
      if (expansion.sidebarSectionId) {
        const sidebarSectionId = expansion.sidebarSectionId;
        setCollapsedSidebarSectionIdList((current) =>
          removeCollapsedIds(current, new Set([sidebarSectionId])),
        );
      }
    }
  }, [
    selectedThreadId,
    threadsReady,
    preferencesReady,
    organizationMode,
    threads,
    threadById,
    effectivePinnedThreadIds,
    setCollapsedThreadIdList,
    setCollapsedEnvironmentIdList,
    setCollapsedProjectIdList,
    setCollapsedMachineKeyList,
    setCollapsedSectionList,
    setCollapsedSidebarSectionIdList,
  ]);
}
