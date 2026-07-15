import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  getThreadRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";

export interface PaneContextValue {
  paneId: string;
  isFocused: boolean;
  /**
   * Whether this pane may show its secondary panel. Always true for the page
   * surface; false for unfocused panes once the split reaches ≥3
   * panes (no room for two secondary panels).
   */
  canShowSecondaryPanel: boolean;
  /**
   * Closes this pane, or null when closing isn't available (single pane or
   * page). Bridges the pane close affordance and archive/delete-when-split.
   */
  onRequestClose: (() => void) | null;
  /**
   * True when this pane renders inside a bounded split card (multi-pane
   * layouts). Bounded panes suppress the page-bleed negative margins in
   * ThreadDetailSecondaryContent — the content fills the card exactly, so the
   * card needs no cancelling padding and shows no dead band at the bottom.
   * False on the page and single-pane surfaces, which keep the
   * full-bleed page layout.
   */
  isBoundedPane: boolean;
  navigateInPane: (thread: ThreadRoutePathArgs) => void;
  /**
   * Starts a pane-reorder drag from the pane header via the shared split-drag
   * layer (move to an edge / swap on center). Only provided when the layout is
   * split (>1 pane); undefined on the single-pane and page surfaces,
   * where there is nothing to reorder.
   */
  beginPaneDrag?: (event: ReactPointerEvent, label: string) => void;
}

export const PaneContext = createContext<PaneContextValue | null>(null);

export function usePaneContext(): PaneContextValue {
  const context = useContext(PaneContext);
  if (context === null) {
    throw new Error("usePaneContext must be used within a <PaneContext>");
  }
  return context;
}

interface DefaultPaneContextProviderProps {
  children: ReactNode;
}

export function DefaultPaneContextProvider({
  children,
}: DefaultPaneContextProviderProps) {
  const navigate = useNavigate();
  const navigateInPane = useCallback(
    (thread: ThreadRoutePathArgs) => {
      navigate(getThreadRoutePath(thread));
    },
    [navigate],
  );
  const value = useMemo<PaneContextValue>(
    () => ({
      paneId: "main",
      isFocused: true,
      canShowSecondaryPanel: true,
      onRequestClose: null,
      isBoundedPane: false,
      navigateInPane,
    }),
    [navigateInPane],
  );

  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}
