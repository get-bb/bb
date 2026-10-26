import { createContext, useContext } from "react";

export const SelectionAddToChatContext = createContext<
  ((text: string) => void) | undefined
>(undefined);

export function useSelectionAddToChat() {
  return useContext(SelectionAddToChatContext);
}
