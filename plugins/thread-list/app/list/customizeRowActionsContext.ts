import { createContext, useContext } from "react";

export const CustomizeRowActionsContext = createContext<
  ((threadId: string) => void) | null
>(null);

export function useCustomizeThreadRowActions():
  | ((threadId: string) => void)
  | null {
  return useContext(CustomizeRowActionsContext);
}

export interface ThreadRowActionsCustomizing {
  threadId: string;
  onDone: (restoreFocus: boolean) => void;
}

export const ThreadRowActionsCustomizingContext =
  createContext<ThreadRowActionsCustomizing | null>(null);

export function useThreadRowActionsCustomizing(
  threadId: string,
): ((restoreFocus: boolean) => void) | null {
  const customizing = useContext(ThreadRowActionsCustomizingContext);
  return customizing?.threadId === threadId ? customizing.onDone : null;
}
