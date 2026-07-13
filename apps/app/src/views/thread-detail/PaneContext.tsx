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
  getSurfaceAwareThreadRoutePath,
  type ThreadRoutePathArgs,
  type ThreadRouteSurface,
} from "@/lib/route-paths";

export interface PaneContextValue {
  paneId: string;
  isFocused: boolean;
  /**
   * Whether this pane may show its secondary panel. Always true for the page
   * and popout surfaces; false for unfocused panes once the split reaches ≥3
   * panes (no room for two secondary panels).
   */
  canShowSecondaryPanel: boolean;
  /**
   * Closes this pane, or null when closing isn't available (single pane, page,
   * or popout). Bridges the pane close affordance and archive/delete-when-split.
   */
  onRequestClose: (() => void) | null;
  navigateInPane: (thread: ThreadRoutePathArgs) => void;
  /**
   * Starts a pane-reorder drag from the pane header via the shared split-drag
   * layer (move to an edge / swap on center). Only provided when the layout is
   * split (>1 pane); undefined on the single-pane, page, and popout surfaces,
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
  surface: ThreadRouteSurface;
}

export function DefaultPaneContextProvider({
  children,
  surface,
}: DefaultPaneContextProviderProps) {
  const navigate = useNavigate();
  const navigateInPane = useCallback(
    (thread: ThreadRoutePathArgs) => {
      navigate(
        getSurfaceAwareThreadRoutePath({
          ...thread,
          surface,
        }),
      );
    },
    [navigate, surface],
  );
  const value = useMemo<PaneContextValue>(
    () => ({
      paneId: "main",
      isFocused: true,
      canShowSecondaryPanel: true,
      onRequestClose: null,
      navigateInPane,
    }),
    [navigateInPane],
  );

  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}
