import { createContext, useContext } from "react";

/**
 * Identifies the plugin owning the current slot mount. Every mounted plugin
 * slot component is wrapped in a provider (see PluginSlotMount); the plugin
 * SDK hooks read it to scope rpc/settings/realtime to their plugin.
 */
export const PluginContext = createContext<string | null>(null);

/**
 * Lets SDK hooks register imperative state they acquire on behalf of a slot.
 * The slot boundary releases these owners immediately when a descendant
 * crashes, including before that descendant's passive effects ever commit.
 */
export interface PluginSlotOwnershipRegistry {
  register(owner: symbol, release: () => void): void;
  unregister(owner: symbol): void;
}

export const PluginSlotOwnershipContext =
  createContext<PluginSlotOwnershipRegistry | null>(null);

export function usePluginId(): string {
  const pluginId = useContext(PluginContext);
  if (pluginId === null) {
    throw new Error(
      "plugin SDK hooks can only be used inside a plugin slot component",
    );
  }
  return pluginId;
}
