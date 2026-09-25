import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import type { SidebarSectionDefinition } from "../model/project-thread-groups.js";
import {
  buildSidebarEntitySectionId,
  normalizeSidebarSectionOrder,
} from "../model/sidebar-section-order.js";
import { useSdk } from "@get-bb/plugin-sdk/app";
import {
  sidebarManualSectionOrderAtom,
  sidebarOrganizationModeAtom,
} from "../preferences/atoms.js";
import type { SidebarThread } from "../model/sidebar-thread.js";

export interface ThreadSectionMoveDestination {
  label: string;
  sectionId: string | null;
}

export interface ThreadSectionMoveContextValue {
  destinations: readonly ThreadSectionMoveDestination[];
  moveThread: (thread: SidebarThread, sectionId: string | null) => void;
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
  const sdk = useSdk();
  const value = useMemo<ThreadSectionMoveContextValue>(
    () => ({
      destinations,
      moveThread: (thread, sectionId) => {
        const threadId = thread.id;
        if (thread.pinnedAt !== null) {
          if (thread.sectionId === sectionId) {
            void sdk.threads.unpin({ threadId }).catch(() => {
              toast.error("Failed to unpin thread.");
            });
            return;
          }
          void sdk.threads
            .unpin({ threadId })
            .then(() => sdk.threads.update({ threadId, sectionId }))
            .catch(() => {
              toast.error("Failed to unpin and move thread.");
            });
          return;
        }
        if (thread.sectionId === sectionId) return;
        void sdk.threads.update({ threadId, sectionId }).catch(() => {
          toast.error("Failed to move thread.");
        });
      },
    }),
    [destinations, sdk],
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
  const storedOrder = useAtomValue(sidebarManualSectionOrderAtom);
  const entitySectionIds = useMemo(
    () =>
      sections.map((section) =>
        buildSidebarEntitySectionId("section", section.id),
      ),
    [sections],
  );
  const order = useMemo(
    () =>
      normalizeSidebarSectionOrder({
        storedOrder,
        entitySectionIds,
        legacyEntityAnchor: "sections",
        hasPinnedSection: true,
      }),
    [entitySectionIds, storedOrder],
  );
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
