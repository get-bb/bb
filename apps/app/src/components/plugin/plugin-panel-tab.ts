import { createContext, useContext } from "react";

export interface PluginPanelTabIdentity {
  pluginId: string;
  tabId: string;
}

export const PluginPanelTabContext =
  createContext<PluginPanelTabIdentity | null>(null);

export function usePluginPanelTab(): PluginPanelTabIdentity | null {
  return useContext(PluginPanelTabContext);
}
