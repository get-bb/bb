import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import {
  buildSidebarEntitySectionId,
  type SidebarSectionDefinition,
} from "@bb/client-core";
import { sidebarOrganizationModeAtom } from "@/components/sidebar/sidebarCollapsedAtoms";
import { useSidebarModeSectionOrder } from "@/components/sidebar/useSidebarModeSectionOrder";
import type { Thread } from "@bb/domain";
import { useMoveThreadToSection } from "@/hooks/mutations/thread-state-mutations";

export interface ThreadSectionMoveDestination {
  label: string;
  sectionId: string | null;
}

interface ThreadSectionMoveContextValue {
  destinations: readonly ThreadSectionMoveDestination[];
  moveThread: (thread: Thread, sectionId: string | null) => void;
}

const ThreadSectionMoveContext =
  createContext<ThreadSectionMoveContextValue | null>(null);

export function useThreadSectionMove(): ThreadSectionMoveContextValue | null {
  return useContext(ThreadSectionMoveContext);
}

export function ThreadSectionMoveProvider({
  children,
  destinations,
  enabled = true,
}: {
  children: ReactNode;
  destinations: readonly ThreadSectionMoveDestination[];
  enabled?: boolean;
}) {
  const moveThreadToSection = useMoveThreadToSection();
  const value = useMemo<ThreadSectionMoveContextValue>(
    () => ({
      destinations,
      moveThread: (thread, sectionId) => {
        moveThreadToSection({ thread, sectionId });
      },
    }),
    [destinations, moveThreadToSection],
  );

  return (
    <ThreadSectionMoveContext.Provider value={enabled ? value : null}>
      {children}
    </ThreadSectionMoveContext.Provider>
  );
}

export function AppThreadSectionMoveProvider({
  children,
  sections,
}: {
  children: ReactNode;
  sections: readonly SidebarSectionDefinition[];
}) {
  const mode = useAtomValue(sidebarOrganizationModeAtom);
  const entitySectionIds = useMemo(
    () =>
      sections.map((section) =>
        buildSidebarEntitySectionId("section", section.id),
      ),
    [sections],
  );
  const { order } = useSidebarModeSectionOrder({
    mode: "chronological",
    entitySectionIds,
    showPinnedSection: false,
  });
  const destinations = useMemo<ThreadSectionMoveDestination[]>(() => {
    const byId = new Map(
      sections.map((section) => [
        buildSidebarEntitySectionId("section", section.id),
        { label: section.name, sectionId: section.id },
      ]),
    );
    return order.flatMap<ThreadSectionMoveDestination>((id) => {
      if (id === "threads") return [{ label: "Threads", sectionId: null }];
      const destination = byId.get(id);
      return destination ? [destination] : [];
    });
  }, [order, sections]);

  return (
    <ThreadSectionMoveProvider
      destinations={destinations}
      enabled={mode === "chronological"}
    >
      {children}
    </ThreadSectionMoveProvider>
  );
}
