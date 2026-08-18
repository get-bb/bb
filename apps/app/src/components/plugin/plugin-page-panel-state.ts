export function getPluginPagePanelStateId({
  panelPath,
  paneId,
  pluginId,
}: {
  panelPath: string;
  paneId?: string;
  pluginId: string;
}): string {
  return `plugin-panel:${pluginId}:${panelPath}:${paneId ?? "standalone"}`;
}
