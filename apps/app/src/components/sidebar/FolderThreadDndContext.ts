import { createContext, useContext } from "react";
import type { FolderThreadDndState } from "./useFolderThreadDnd";

const FolderThreadDndContext = createContext<FolderThreadDndState | null>(null);

export const FolderThreadDndProvider = FolderThreadDndContext.Provider;

export function useChronologicalFolderThreadDnd(): FolderThreadDndState | null {
  return useContext(FolderThreadDndContext);
}
