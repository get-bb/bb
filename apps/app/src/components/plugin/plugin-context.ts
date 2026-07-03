import { createContext, useContext } from "react";

/**
 * Identifies the plugin owning the current slot mount. Every mounted plugin
 * slot component is wrapped in a provider (see PluginSlotMount); the plugin
 * SDK hooks read it to scope rpc/settings/realtime to their plugin.
 */
export const PluginContext = createContext<string | null>(null);

export function usePluginId(): string {
  const pluginId = useContext(PluginContext);
  if (pluginId === null) {
    throw new Error(
      "plugin SDK hooks can only be used inside a plugin slot component",
    );
  }
  return pluginId;
}
