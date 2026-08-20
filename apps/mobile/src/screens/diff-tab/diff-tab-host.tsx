import { createContext, useContext, type ReactNode } from "react";

/**
 * What the surface hosting the Diff tab (the workspace panel over a thread,
 * the root compose panel) lets the tab do beyond rendering: quote text into
 * the thread's composer ("Add to chat"), open a file preview, and strip the
 * workspace root from displayed paths. Every member is optional so the tab
 * renders without a host (the actions that need one hide).
 */
export interface DiffTabHost {
  /**
   * Quote text into the composer (the thread screen's `quoteIntoComposer`
   * from `useFollowUpComposer`). The host is expected to close its panel /
   * sheet and focus the composer afterwards.
   */
  quoteIntoComposer?: (text: string) => void;
  /** Open a workspace file preview (the Phase 6 Files surface). */
  openFilePreview?: (path: string) => void;
  /** The environment's root path (`environment.path`), for display. */
  workspaceRootPath?: string | null;
}

const EMPTY_HOST: DiffTabHost = {};

const DiffTabHostContext = createContext<DiffTabHost>(EMPTY_HOST);

export interface DiffTabHostProviderProps {
  value: DiffTabHost;
  children: ReactNode;
}

export function DiffTabHostProvider({
  value,
  children,
}: DiffTabHostProviderProps) {
  return (
    <DiffTabHostContext.Provider value={value}>
      {children}
    </DiffTabHostContext.Provider>
  );
}

export function useDiffTabHost(): DiffTabHost {
  return useContext(DiffTabHostContext);
}
