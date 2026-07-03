/**
 * The typed fixed-view union of the thread secondary panel. Plugin
 * `threadPanelTab` slots (plugin design §5.2) extend it with an opaque
 * `plugin:<pluginId>:<tabId>` key — both segments are validated to
 * `[a-zA-Z0-9_-]+` at registration time, so the key parses unambiguously.
 */
export type PluginThreadPanelKey = `plugin:${string}:${string}`;

export type ThreadSecondaryPanel =
  | "git-diff"
  | "thread-info"
  | PluginThreadPanelKey;

export function buildPluginThreadPanelKey(
  pluginId: string,
  tabId: string,
): PluginThreadPanelKey {
  return `plugin:${pluginId}:${tabId}`;
}

export interface ParsedPluginThreadPanelKey {
  pluginId: string;
  tabId: string;
}

export function parsePluginThreadPanelKey(
  panel: string,
): ParsedPluginThreadPanelKey | null {
  const segments = panel.split(":");
  if (
    segments.length !== 3 ||
    segments[0] !== "plugin" ||
    !segments[1] ||
    !segments[2]
  ) {
    return null;
  }
  return { pluginId: segments[1], tabId: segments[2] };
}
