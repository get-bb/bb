import type { PluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";

export function pluginPanelTabFillsRegion(
  tab: PluginPanelFixedPanelTab | null,
): boolean {
  // PluginPanelTabContent owns the complete body frame for every plugin tab:
  // padded actions provide their own padded scroll container, while flush
  // actions and file openers provide their own full-bleed layout. Letting the
  // file-preview shell frame a padded action adds a second scroll container
  // and an extra bottom gutter.
  return tab !== null;
}
