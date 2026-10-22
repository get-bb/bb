import { createContext, useContext, type ReactNode } from "react";

export const ThreadDiffContentContext = createContext<ReactNode>(null);
export const ThreadDiffVisibilityContext = createContext(true);

export function ThreadDiffFixedTabContent() {
  return useContext(ThreadDiffContentContext);
}

export function useThreadDiffVisible() {
  return useContext(ThreadDiffVisibilityContext);
}
