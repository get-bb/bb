import { createContext, useContext, useMemo, type ReactNode } from "react";
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
}: {
  children: ReactNode;
  destinations: readonly ThreadSectionMoveDestination[];
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
    <ThreadSectionMoveContext.Provider value={value}>
      {children}
    </ThreadSectionMoveContext.Provider>
  );
}
