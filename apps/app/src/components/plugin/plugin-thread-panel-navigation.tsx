import { createContext, type ReactNode, useContext } from "react";
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
