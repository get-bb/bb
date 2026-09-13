import { useMemo } from "react";
import type { ThreadListEntry } from "@bb/domain";
import {
  CHRONOLOGICAL_CONTAINER_ID,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type SidebarSectionDefinition,
  type ThreadComparator,
} from "@bb/client-core";
import {
  resolveSidebarDropPreviewPlacement,
  type SidebarDropPreviewTarget,
} from "./sidebarDropPreviewPlacement";
import {
  PINNED_THREAD_PARENT_KEY,
  type SectionThreadDndState,
} from "./useSectionThreadDnd";

interface ShouldSuppressPinnedThreadDropPreviewArgs {
  activeThreadId: string | undefined;
  dragOverParentKey: string | null;
  pinnedThreads: readonly Pick<ThreadListEntry, "id">[];
}

export function shouldSuppressPinnedThreadDropPreview({
  activeThreadId,
  dragOverParentKey,
  pinnedThreads,
}: ShouldSuppressPinnedThreadDropPreviewArgs): boolean {
  return (
    activeThreadId !== undefined &&
    dragOverParentKey === PINNED_THREAD_PARENT_KEY &&
    pinnedThreads.some((thread) => thread.id === activeThreadId)
  );
}

interface ResolveDropPreviewTargetArgs {
  dragOverParentKey: string | null;
  groups: boolean;
  nestTarget: SectionThreadDndState["nestTarget"];
  reorderTarget: SectionThreadDndState["reorderTarget"];
  rootItems: readonly ProjectThreadItem[];
}

export function resolveDropPreviewTarget({
  dragOverParentKey,
  groups,
  nestTarget,
  reorderTarget,
  rootItems,
}: ResolveDropPreviewTargetArgs): SidebarDropPreviewTarget | null {
  if (nestTarget?.state === "valid") {
    return { kind: "nest", parentThreadId: nestTarget.threadId };
  }
  if (dragOverParentKey === null) return null;
  if (dragOverParentKey === PINNED_THREAD_PARENT_KEY) {
    return reorderTarget
      ? null
      : { kind: "pinned", parentKey: PINNED_THREAD_PARENT_KEY };
  }
  if (dragOverParentKey === CHRONOLOGICAL_CONTAINER_ID) {
    return groups
      ? {
          kind: "group",
          parentKey: CHRONOLOGICAL_CONTAINER_ID,
          items: rootItems.filter((item) => item.kind !== "section"),
        }
      : {
          kind: "container",
          parentKey: CHRONOLOGICAL_CONTAINER_ID,
          sectionId: null,
        };
  }
  for (const item of rootItems) {
    if (item.kind === "section" && item.group.key === dragOverParentKey) {
      return groups
        ? { kind: "group", parentKey: item.group.key, items: item.group.items }
        : {
            kind: "container",
            parentKey: item.group.key,
            sectionId: item.group.id,
          };
    }
  }
  return null;
}

interface UseRenderedSectionThreadDndArgs {
  compareThreads: ThreadComparator;
  draftThreadIds: ReadonlySet<string>;
  groups?: boolean;
  pinnedRootNodes: readonly ProjectThreadNode[];
  pinnedThreads: readonly ThreadListEntry[];
  rootItems: readonly ProjectThreadItem[];
  sectionDnd: SectionThreadDndState | null;
  sections: readonly SidebarSectionDefinition[];
  threads: readonly ThreadListEntry[];
}

export function useRenderedSectionThreadDnd({
  compareThreads,
  draftThreadIds,
  groups = false,
  pinnedRootNodes,
  pinnedThreads,
  rootItems,
  sectionDnd,
  sections,
  threads,
}: UseRenderedSectionThreadDndArgs): SectionThreadDndState | null {
  return useMemo<SectionThreadDndState | null>(() => {
    if (!sectionDnd) {
      return null;
    }
    const activeThread = sectionDnd.activeThread;
    const suppressPinnedDropPreview = shouldSuppressPinnedThreadDropPreview({
      activeThreadId: activeThread?.id,
      dragOverParentKey: sectionDnd.dragOverParentKey,
      pinnedThreads,
    });
    if (suppressPinnedDropPreview) {
      return { ...sectionDnd, dragOverParentKey: null, dropPreview: null };
    }
    if (!activeThread) {
      return sectionDnd;
    }
    const target = resolveDropPreviewTarget({
      dragOverParentKey: sectionDnd.dragOverParentKey,
      groups,
      nestTarget: sectionDnd.nestTarget,
      reorderTarget: sectionDnd.reorderTarget,
      rootItems,
    });
    return {
      ...sectionDnd,
      dropPreview: target
        ? resolveSidebarDropPreviewPlacement({
            activeThread,
            compareThreads,
            draftThreadIds,
            pinnedRootNodes,
            sections,
            target,
            threads,
          })
        : null,
    };
  }, [
    compareThreads,
    draftThreadIds,
    groups,
    pinnedRootNodes,
    pinnedThreads,
    rootItems,
    sectionDnd,
    sections,
    threads,
  ]);
}
