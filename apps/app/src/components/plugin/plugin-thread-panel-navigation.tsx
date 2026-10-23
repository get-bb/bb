import {
  createContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  useContext,
} from "react";
import type { PluginTargetedPanelActionOpenOptions } from "@get-bb/plugin-sdk";

export type PluginThreadPanelOpenHandler = (
  options: PluginTargetedPanelActionOpenOptions & {
    pluginId: string;
    replaceTabId?: string;
  },
) => boolean;

export interface PluginPanelTabIdentity {
  pluginId: string;
  tabId: string;
}

const PluginThreadPanelNavigationContext =
  createContext<PluginThreadPanelOpenHandler | null>(null);

export const PluginPanelTabContext =
  createContext<PluginPanelTabIdentity | null>(null);

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

export function usePluginPanelTab(): PluginPanelTabIdentity | null {
  return useContext(PluginPanelTabContext);
}

export function openPluginThreadPanel({
  open,
  options,
  panelTab,
  pluginId,
}: {
  open: PluginThreadPanelOpenHandler | null;
  options: PluginTargetedPanelActionOpenOptions & {
    experimental_replace?: boolean;
  };
  panelTab: PluginPanelTabIdentity | null;
  pluginId: string;
}): boolean {
  if (open === null) return false;
  const request = {
    pluginId,
    actionId: options.actionId,
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.params === undefined ? {} : { params: options.params }),
  };
  if (options.experimental_replace !== true) return open(request);
  if (panelTab === null || panelTab.pluginId !== pluginId) return false;
  return open({ ...request, replaceTabId: panelTab.tabId });
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
