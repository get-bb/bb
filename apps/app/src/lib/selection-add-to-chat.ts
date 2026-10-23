import { createContext, useContext } from "react";

export type SelectionAddToChatHandler = (text: string) => void;

export const SelectionAddToChatContext =
  createContext<SelectionAddToChatHandler | null>(null);

export function useSelectionAddToChat(): SelectionAddToChatHandler | null {
  return useContext(SelectionAddToChatContext);
}
