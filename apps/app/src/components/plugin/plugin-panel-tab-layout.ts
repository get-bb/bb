import type { PluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";

interface PluginPanelLayoutAction {
  readonly id: string;
  readonly layout?: "padded" | "flush";
  readonly pluginId: string;
}

export function pluginPanelTabFillsRegion(
  tab: PluginPanelFixedPanelTab | null,
  actions: readonly PluginPanelLayoutAction[],
): boolean {
  if (tab === null) return false;
  if (tab.fileOpenerOwner !== undefined) return true;
  return actions.some(
    (action) =>
      action.pluginId === tab.pluginId &&
      action.id === tab.actionId &&
      action.layout === "flush",
  );
}
