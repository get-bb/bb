import {
  createContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  useContext,
} from "react";
import type { BbNavigate } from "@get-bb/plugin-sdk";

export type PluginThreadPanelOpenHandler = (
  options: Parameters<BbNavigate["openThreadPanel"]>[0] & {
    pluginId: string;
  },
) => boolean;

const PluginThreadPanelNavigationContext =
  createContext<PluginThreadPanelOpenHandler | null>(null);

export function PluginThreadPanelNavigationProvider({
  children,
  openThreadPanel,
}: {
  children: ReactNode;
  openThreadPanel: PluginThreadPanelOpenHandler;
}) {
  return (
    <PluginThreadPanelNavigationContext.Provider value={openThreadPanel}>
      {children}
    </PluginThreadPanelNavigationContext.Provider>
  );
}

export function usePluginThreadPanelOpenHandler(): PluginThreadPanelOpenHandler | null {
  return useContext(PluginThreadPanelNavigationContext);
}

// ---------------------------------------------------------------------------
// Active opener, for host surfaces mounted outside the provider
// ---------------------------------------------------------------------------

/**
 * The focused thread view's opener, published to a module-level store.
 *
 * The context above only reaches descendants of a thread view, which is right
 * for the timeline and its message actions. The quick palette is mounted by
 * `AppLayout` beside the routes, so it can never read that context, yet a
 * plugin's palette row must still be able to open that plugin's panel in the
 * thread the user is looking at.
 *
 * Only the focused pane publishes, because a split has one opener per pane and
 * "the thread side panel" otherwise has no single meaning. A lone thread view
 * counts as focused (see `DefaultPaneContextProvider`).
 */
const focusedOpeners = new Map<symbol, PluginThreadPanelOpenHandler>();

export function usePublishThreadPanelOpener(
  openThreadPanel: PluginThreadPanelOpenHandler,
  isActive: boolean,
): void {
  const handlerRef = useRef(openThreadPanel);
  useLayoutEffect(() => {
    handlerRef.current = openThreadPanel;
  }, [openThreadPanel]);
  const tokenRef = useRef<symbol | null>(null);
  tokenRef.current ??= Symbol("thread-panel-opener");
  useEffect(() => {
    const token = tokenRef.current;
    if (token === null || !isActive) return;
    focusedOpeners.set(token, (options) => handlerRef.current(options));
    return () => {
      focusedOpeners.delete(token);
    };
  }, [isActive]);
}

/**
 * Null when no thread view is on screen — the palette then reports a declined
 * open to the plugin rather than pretending. During a focus handover two views
 * can briefly claim focus; the most recent one wins.
 */
export function getActiveThreadPanelOpener(): PluginThreadPanelOpenHandler | null {
  let active: PluginThreadPanelOpenHandler | null = null;
  for (const opener of focusedOpeners.values()) active = opener;
  return active;
}

export function resetActiveThreadPanelOpenerForTest(): void {
  focusedOpeners.clear();
}
