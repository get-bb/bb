import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

const OpenThreadInSplitContext = createContext<
  ((threadId: string) => void) | null
>(null);

export function ThreadRowNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const navigate = useBbNavigate();
  const latest = useRef(navigate);
  useLayoutEffect(() => {
    latest.current = navigate;
  });
  const openInSplit = useCallback((threadId: string) => {
    latest.current.toThread(threadId, { split: true });
  }, []);
  return (
    <OpenThreadInSplitContext.Provider value={openInSplit}>
      {children}
    </OpenThreadInSplitContext.Provider>
  );
}

export function useOpenThreadInSplit(): (threadId: string) => void {
  const openInSplit = useContext(OpenThreadInSplitContext);
  if (openInSplit === null) {
    throw new Error(
      "useOpenThreadInSplit must be used within a <ThreadRowNavigationProvider>",
    );
  }
  return openInSplit;
}
