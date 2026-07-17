import { createContext, useContext } from "react";
import type { SectionThreadDndState } from "./useSectionThreadDnd";

const SectionThreadDndContext = createContext<SectionThreadDndState | null>(
  null,
);

export const SectionThreadDndProvider = SectionThreadDndContext.Provider;

export function useChronologicalSectionThreadDnd(): SectionThreadDndState | null {
  return useContext(SectionThreadDndContext);
}
