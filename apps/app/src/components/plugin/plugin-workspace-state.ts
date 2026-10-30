import { z } from "zod";
import { getLocalStorage } from "@/lib/browser-storage";

export const PLUGINS_BROWSE_PANEL_STATE_ID = "plugins-browse";

const LEGACY_PLUGIN_WORKSPACE_STORAGE_KEY = "bb.plugins.workspace.tabs";

const legacyPluginWorkspaceSchema = z.object({
  tabs: z.array(z.string().min(1)).max(100),
  activePluginId: z.string().nullable(),
});

export interface LegacyPluginWorkspaceTabs {
  detailKeys: readonly string[];
  activeDetailKey: string | null;
}

export function takeLegacyPluginWorkspaceTabs(): LegacyPluginWorkspaceTabs | null {
  const storage = getLocalStorage();
  const stored = storage?.getItem(LEGACY_PLUGIN_WORKSPACE_STORAGE_KEY) ?? null;
  if (storage === null || stored === null) return null;
  storage.removeItem(LEGACY_PLUGIN_WORKSPACE_STORAGE_KEY);
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  const parsed = legacyPluginWorkspaceSchema.safeParse(value);
  if (!parsed.success) return null;
  const detailKeys = [...new Set(parsed.data.tabs)];
  const activeDetailKey = parsed.data.activePluginId;
  return {
    detailKeys,
    activeDetailKey:
      activeDetailKey !== null && detailKeys.includes(activeDetailKey)
        ? activeDetailKey
        : null,
  };
}
