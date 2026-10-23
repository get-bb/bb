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

export function getActiveThreadPanelOpener(): PluginThreadPanelOpenHandler | null {
  let active: PluginThreadPanelOpenHandler | null = null;
  for (const opener of focusedOpeners.values()) active = opener;
  return active;
}

export function resetActiveThreadPanelOpenerForTest(): void {
  focusedOpeners.clear();
}

export type PluginThreadFixedTabToggleHandler = (tab: {
  pluginId: string;
  tabId: string;
}) => boolean;

const focusedTogglers = new Map<symbol, PluginThreadFixedTabToggleHandler>();

export function usePublishThreadFixedTabToggler(
  toggle: PluginThreadFixedTabToggleHandler,
  isActive: boolean,
): void {
  const handlerRef = useRef(toggle);
  useLayoutEffect(() => {
    handlerRef.current = toggle;
  }, [toggle]);
  const tokenRef = useRef<symbol | null>(null);
  tokenRef.current ??= Symbol("thread-fixed-tab-toggler");
  useEffect(() => {
    const token = tokenRef.current;
    if (token === null || !isActive) return;
    focusedTogglers.set(token, (tab) => handlerRef.current(tab));
    return () => {
      focusedTogglers.delete(token);
    };
  }, [isActive]);
}

export function getActiveThreadFixedTabToggler(): PluginThreadFixedTabToggleHandler | null {
  let active: PluginThreadFixedTabToggleHandler | null = null;
  for (const toggler of focusedTogglers.values()) active = toggler;
  return active;
}
