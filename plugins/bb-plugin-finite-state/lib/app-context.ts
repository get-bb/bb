// FROZEN. Amend only through AMENDMENTS.md and a CONTRACT_VERSION broadcast.
export const PLUGIN_ID = "finite-state" as const;

export interface AppContext {
  readonly pluginId: typeof PLUGIN_ID;
}

export function createAppContext(): AppContext {
  return { pluginId: PLUGIN_ID };
}
