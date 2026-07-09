import { createContext, useContext, type ReactNode } from "react";

const MobilePromptBoxMinimizedContext = createContext(false);

export function MobilePromptBoxMinimizedProvider({
  children,
  isMinimized,
}: {
  children: ReactNode;
  isMinimized: boolean;
}) {
  return (
    <MobilePromptBoxMinimizedContext.Provider value={isMinimized}>
      {children}
    </MobilePromptBoxMinimizedContext.Provider>
  );
}

export function useMobilePromptBoxMinimizedState(): boolean {
  return useContext(MobilePromptBoxMinimizedContext);
}
