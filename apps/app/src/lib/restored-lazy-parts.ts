import { matchPath } from "react-router-dom";
import { CORE_PLUGIN_ID } from "@bb/domain";
import {
  registrationComponents,
  type CollectedPluginAppRegistrations,
} from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import type { FixedPanelTabsState } from "./fixed-panel-tabs-state";
import {
  PLUGIN_PANEL_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  getThreadRouteThreadId,
} from "./route-paths";

export type RestoredLazyPart =
  | { kind: "settings-page"; pluginId: string }
  | { kind: "nav-panel-page"; pluginId: string; path: string }
  | { kind: "panel-tab"; pluginId: string; tabId: string }
  | { kind: "panel-action"; pluginId: string; actionId: string }
  | { kind: "info-tab" };

export function restoredPageLazyParts(pathname: string): RestoredLazyPart[] {
  const settings = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, pathname);
  if (settings?.params.pluginId !== undefined) {
    return [{ kind: "settings-page", pluginId: settings.params.pluginId }];
  }
  const panel = matchPath(PLUGIN_PANEL_ROUTE_PATH, pathname);
  if (
    panel?.params.pluginId !== undefined &&
    panel.params.panelPath !== undefined
  ) {
    return [
      {
        kind: "nav-panel-page",
        pluginId: panel.params.pluginId,
        path: panel.params.panelPath,
      },
    ];
  }
  return [];
}

export function restoredLazyParts(
  pathname: string,
  readPanelTabs: (threadId: string) => FixedPanelTabsState,
): RestoredLazyPart[] {
  const pageParts = restoredPageLazyParts(pathname);
  if (pageParts.length > 0) return pageParts;
  const threadId = getThreadRouteThreadId(pathname);
  if (threadId === null) return [];
  const { secondary } = readPanelTabs(threadId);
  if (!secondary.isOpen) return [];
  const tab = secondary.tabs.find(
    (candidate) => candidate.id === secondary.activeTabId,
  );
  switch (tab?.kind) {
    case "plugin-fixed":
      return tab.pluginId === CORE_PLUGIN_ID && tab.tabId === "info"
        ? [{ kind: "info-tab" }]
        : [{ kind: "panel-tab", pluginId: tab.pluginId, tabId: tab.tabId }];
    case "plugin-panel":
      return [
        {
          kind: "panel-action",
          pluginId: tab.pluginId,
          actionId: tab.actionId,
        },
      ];
    default:
      return [];
  }
}

export function namesPlugin(part: RestoredLazyPart, pluginId: string): boolean {
  return part.kind !== "info-tab" && part.pluginId === pluginId;
}

export function holdsPage(part: RestoredLazyPart): boolean {
  return part.kind === "settings-page" || part.kind === "nav-panel-page";
}

export function restoredPartComponents(
  part: RestoredLazyPart,
  pluginId: string,
  registrations: CollectedPluginAppRegistrations,
): unknown[] {
  if (part.kind !== "info-tab" && part.pluginId !== pluginId) return [];
  switch (part.kind) {
    case "settings-page":
      return registrations.settingsSections.flatMap((registration) =>
        registrationComponents("settingsSections", registration),
      );
    case "nav-panel-page":
      return registrations.navPanels
        .filter((registration) => registration.path === part.path)
        .flatMap((registration) =>
          registrationComponents("navPanels", registration),
        );
    case "panel-tab":
      return registrations.tabs
        .filter((registration) => registration.id === part.tabId)
        .flatMap((registration) =>
          registrationComponents("tabs", registration),
        );
    case "panel-action":
      return registrations.threadPanelActions
        .filter((registration) => registration.id === part.actionId)
        .flatMap((registration) =>
          registrationComponents("threadPanelActions", registration),
        );
    case "info-tab":
      return [
        ...registrations.threadInfoRows.flatMap((registration) =>
          registrationComponents("threadInfoRows", registration),
        ),
        ...registrations.threadInfoSections.flatMap((registration) =>
          registrationComponents("threadInfoSections", registration),
        ),
      ];
  }
}
