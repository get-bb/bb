import { createContext, useContext } from "react";

export const TabVisibleContext = createContext<boolean | null>(null);

export function useTabVisible(): boolean {
  return useContext(TabVisibleContext) ?? false;
}

export function useShownOutsideHiddenTab(): boolean {
  return useContext(TabVisibleContext) ?? true;
}
