import { createContext, useContext } from "react";

export const CustomizeRowActionsContext = createContext<
  ((threadId: string) => void) | null
>(null);

export function useCustomizeThreadRowActions():
  | ((threadId: string) => void)
  | null {
  return useContext(CustomizeRowActionsContext);
}
