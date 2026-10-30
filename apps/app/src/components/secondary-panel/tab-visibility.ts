import { createContext, useContext } from "react";

export const TabVisibleContext = createContext(false);

export function useTabVisible(): boolean {
  return useContext(TabVisibleContext);
}
