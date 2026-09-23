import { useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { NO_MACHINE_GROUP_KEY } from "../model/machine-thread-groups.js";
import { buildPinnedSidebarState } from "../model/pinned-sidebar-threads.js";
import {
  CHRONOLOGICAL_CONTAINER_ID,
  resolveSidebarProjectId,
} from "../model/project-thread-groups.js";
import { sectionKeyForThreadSection } from "../model/section-keys.js";
import type { CollapsibleSidebarSectionId } from "../model/sidebar-section-id.js";
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
  thread: SidebarThread;
  sidebarProjectId: string;
  personalProjectId: string | null;
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
  personalProjectId,
}: ThreadSidebarExpansionArgs): ThreadSidebarExpansion {
  if (isPinned) {
    return { sidebarSectionId: "pinned" };
  }

  if (organizationMode === "machine") {
    return {
      machineKey: thread.host?.id ?? NO_MACHINE_GROUP_KEY,
    };
  }

  if (organizationMode === "chronological") {
    const sectionKey = sectionKeyForThreadSection(
      CHRONOLOGICAL_CONTAINER_ID,
      thread.sectionId,
    );
    return sectionKey ? { sectionKey } : { sidebarSectionId: "threads" };
  }

  if (sidebarProjectId === personalProjectId) {
    return { sidebarSectionId: "threads" };
  }

  return { projectId: sidebarProjectId };
}

export function useSidebarThreadReveal(): void {
  const { threadId: routedThreadId } = useBbContext();
  const { status, projects, personalProject } = useSidebarData();
  const preferencesReady = usePreferencesReady();
  const threads = useMemo<SidebarThread[]>(
    () => projects.flatMap((project) => project.threads),
    [projects],
  );
  useSidebarThreadRevealCore({
    selectedThreadId: routedThreadId ?? undefined,
    threads,
    threadsReady: status === "ready",
    preferencesReady,
    personalProjectId: personalProject?.id ?? null,
  });
}

export interface SidebarThreadRevealInputs {
  selectedThreadId: string | undefined;
  threads: readonly SidebarThread[];
  threadsReady: boolean;
  preferencesReady: boolean;
  personalProjectId: string | null;
}

export function useSidebarThreadRevealCore({
  selectedThreadId,
  threads,
  threadsReady,
  preferencesReady,
  personalProjectId,
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
      if (thread.isHidden || !thread.isUnread) {
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
      if (!thread || thread.isHidden) {
        continue;
      }
      const threadIdsToExpand = new Set<string>();
      const environmentIdsToExpand = new Set<string>();
      let currentThread: SidebarThread | undefined = thread;
      let remainingHops = threadById.size;
      while (currentThread && remainingHops > 0) {
        const environmentId = currentThread.environment?.id ?? null;
        if (environmentId !== null) {
          environmentIdsToExpand.add(environmentId);
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
        personalProjectId,
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
    personalProjectId,
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
