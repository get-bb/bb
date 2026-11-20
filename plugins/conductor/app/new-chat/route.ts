import type { ExperimentalPluginPanelPage } from "@get-bb/plugin-sdk/app";

export const NEW_CHAT_PANEL_PATH = "new";

export function environmentIdFromSubPath(subPath: string): string | null {
  const [segment] = subPath.split("/");
  if (segment === undefined || segment.length === 0) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function openNewChatEnvironmentId(
  page: ExperimentalPluginPanelPage | null,
  pluginId: string,
): string | null {
  if (page === null || page.pluginId !== pluginId) return null;
  if (page.path !== NEW_CHAT_PANEL_PATH) return null;
  return environmentIdFromSubPath(page.subPath);
}

export function draftKeyFor(environmentId: string): string {
  return `conductor-new-chat:${environmentId}`;
}
