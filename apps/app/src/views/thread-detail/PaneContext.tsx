import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  getThreadRoutePath,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import type { SplitSide } from "@/lib/split-layout";

export interface PaneContextValue {
  paneId: string;
  isFocused: boolean;
  /**
   * True only inside a multi-pane split. Lets keyboard commands scope a
   * caret-outside-composer fallback (e.g. Cmd+Shift+M after keyboard pane
   * navigation) to splits while leaving lone surfaces at their prior behavior.
   */
  isSplitPane: boolean;
  /**
   * Window-level secondary-panel host for a multi-pane workspace. Pane views
   * publish their already-assembled panel model here while retaining ownership
   * of panel tabs, selection, commands, and product policy. Null on standalone
   * and single-pane surfaces, which keep their existing inline/drawer layout.
   */
  secondaryPanelHost: PaneSecondaryPanelRegistration | null;
  /** Whether this pane owns the window's top-right control footprint. */
  reservesWindowPanelToggle: boolean;
  /**
   * Closes this pane, or null when closing isn't available (single pane or
   * page). Bridges the pane close affordance and archive/delete-when-split.
   */
  onRequestClose: (() => void) | null;
  /** True while this pane temporarily fills the split workspace. */
  isMaximized: boolean;
  /** Toggles this pane between its split position and full-workspace display. */
  onToggleMaximize: (() => void) | null;
  /** Moves this pane to one of the split workspace's supported edges. */
  onMoveToSide?: (side: SplitSide) => void;
  /**
   * True when this pane renders inside a bounded split card (multi-pane
   * layouts). Bounded panes suppress the page-bleed negative margins in
   * ThreadDetailSecondaryContent — the content fills the card exactly, so the
   * card needs no cancelling padding and shows no dead band at the bottom.
   * False on the page and single-pane surfaces, which keep the
   * full-bleed page layout.
   */
  isBoundedPane: boolean;
  /**
   * Whether this pane touches the workspace's top edge, where its header
   * occupies the native desktop title-bar row.
   */
  isTopRow: boolean;
  /**
   * Whether this pane owns the window's top-left chrome footprint. This is
   * stricter than {@link isTopRow}: horizontal siblings can all be title-bar
   * drag regions, but only one leaf may reserve traffic-light/sidebar space.
   */
  ownsWindowTopLeft: boolean;
  navigateInPane: (thread: ThreadRoutePathArgs) => void;
  /**
   * Starts a pane-reorder drag from the pane header via the shared split-drag
   * layer (move to an edge / swap on center). Only provided when the layout is
   * split (>1 pane); undefined on the single-pane and page surfaces,
   * where there is nothing to reorder.
   */
  beginPaneDrag?: (event: ReactPointerEvent, label: string) => void;
}

export interface PaneSecondaryPanelViewModel {
  /** Composer owned by this pane, restored where the hosted panel renders. */
  composerHost: PluginComposerHost | null;
  /**
   * Identity of the content backing this panel (threadId, or a surface name
   * for non-thread panes). The workspace host uses it to tell "the focused
   * pane now shows different content" apart from "the same content opened or
   * closed its panel": only the latter may change the window-level panel
   * visibility.
   */
  contentKey: string;
  isMainCollapsed: boolean;
  isOpen: boolean;
  panel: ReactNode;
  onToggle: () => void;
  /** False while mount-time state reconciliation must update without motion. */
  transitionsReady: boolean;
}

export interface PaneSecondaryPanelRegistration {
  clear: () => void;
  publish: (model: PaneSecondaryPanelViewModel) => void;
}

type PaneSecondaryPanelRegistryListener = () => void;

export interface PaneSecondaryPanelRegistry {
  clear: (paneId: string) => void;
  getSnapshot: (paneId: string) => PaneSecondaryPanelViewModel | null;
  publish: (paneId: string, model: PaneSecondaryPanelViewModel) => void;
  subscribe: (
    paneId: string,
    listener: PaneSecondaryPanelRegistryListener,
  ) => () => void;
}

export function createPaneSecondaryPanelRegistry(): PaneSecondaryPanelRegistry {
  const models = new Map<string, PaneSecondaryPanelViewModel>();
  const listeners = new Map<string, Set<PaneSecondaryPanelRegistryListener>>();
  const notify = (paneId: string) => {
    listeners.get(paneId)?.forEach((listener) => listener());
  };

  return {
    clear: (paneId) => {
      if (!models.delete(paneId)) return;
      notify(paneId);
    },
    getSnapshot: (paneId) => models.get(paneId) ?? null,
    publish: (paneId, model) => {
      models.set(paneId, model);
      notify(paneId);
    },
    subscribe: (paneId, listener) => {
      const paneListeners = listeners.get(paneId) ?? new Set();
      paneListeners.add(listener);
      listeners.set(paneId, paneListeners);
      return () => {
        paneListeners.delete(listener);
        if (paneListeners.size === 0) listeners.delete(paneId);
      };
    },
  };
}

export function usePaneSecondaryPanelModel(
  registry: PaneSecondaryPanelRegistry,
  paneId: string,
): PaneSecondaryPanelViewModel | null {
  const subscribe = useCallback(
    (listener: PaneSecondaryPanelRegistryListener) =>
      registry.subscribe(paneId, listener),
    [paneId, registry],
  );
  const getSnapshot = useCallback(
    () => registry.getSnapshot(paneId),
    [paneId, registry],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePaneSecondaryPanelRegistration(
  registration: PaneSecondaryPanelRegistration | null,
  model: PaneSecondaryPanelViewModel,
): void {
  useLayoutEffect(() => {
    if (registration === null) return;
    registration.publish(model);
  }, [model, registration]);
  useLayoutEffect(
    () => (registration === null ? undefined : registration.clear),
    [registration],
  );
}

export const PaneContext = createContext<PaneContextValue | null>(null);

export function usePaneContext(): PaneContextValue {
  const context = useContext(PaneContext);
  if (context === null) {
    throw new Error("usePaneContext must be used within a <PaneContext>");
  }
  return context;
}

export function useOptionalPaneContext(): PaneContextValue | null {
  return useContext(PaneContext);
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
      isSplitPane: false,
      secondaryPanelHost: null,
      reservesWindowPanelToggle: false,
      onRequestClose: null,
      isMaximized: false,
      onToggleMaximize: null,
      isBoundedPane: false,
      isTopRow: true,
      ownsWindowTopLeft: true,
      navigateInPane,
    }),
    [navigateInPane],
  );

  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}
