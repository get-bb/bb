import type { ComponentType } from "react";
import type {
  ExperimentalSidebarNavigationAction,
  ExperimentalSidebarNavigationIcon,
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationShortcut,
} from "@get-bb/plugin-sdk";
import type { PluginNavPanelChromeEntry } from "@/lib/plugin-nav-panel-chrome";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
  getPluginsRoutePath,
  getSkillsRoutePath,
  isToolsRoutePath,
} from "@/lib/route-paths";
import type { PaneContent } from "@/lib/split-layout";
import {
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS,
  DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER,
  getPluginNavPanelKey,
} from "@/components/plugin/pluginNavSidebarOrder";

export const NEW_THREAD_NAVIGATION_ITEM_ID =
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS.newThread;
export const SEARCH_THREADS_NAVIGATION_ITEM_ID =
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS.searchThreads;
export const PLUGINS_NAVIGATION_ITEM_ID =
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS.extensions;
export const SKILLS_NAVIGATION_ITEM_ID =
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS.skills;

export const SIDEBAR_NAVIGATION_LEADING_KEYS =
  DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER;

export interface SidebarNavigationRow {
  pluginId: string;
  id: string;
  label: string;
  icon: ExperimentalSidebarNavigationIcon;
  action: ExperimentalSidebarNavigationAction;
  ownerPluginId: string | null;
  panelEntry: PluginNavPanelChromeEntry | null;
}

const NEW_THREAD_CONTENT = { kind: "new-thread" } as const;

function hostRow(
  key: string,
  label: string,
  icon: Extract<ExperimentalSidebarNavigationIcon, { kind: "host" }>["name"],
  action: ExperimentalSidebarNavigationAction,
): SidebarNavigationRow {
  const [pluginId = "", id = ""] = key.split("/");
  return {
    pluginId,
    id,
    label,
    icon: { kind: "host", name: icon },
    action,
    ownerPluginId: null,
    panelEntry: null,
  };
}

const HOST_ROWS: readonly SidebarNavigationRow[] = [
  hostRow(NEW_THREAD_NAVIGATION_ITEM_ID, "New thread", "new-thread", {
    kind: "new-thread",
  }),
  hostRow(SEARCH_THREADS_NAVIGATION_ITEM_ID, "Search threads", "search", {
    kind: "search-threads",
  }),
  hostRow(PLUGINS_NAVIGATION_ITEM_ID, "Plugins", "extensions", {
    kind: "open-extensions",
  }),
  hostRow(SKILLS_NAVIGATION_ITEM_ID, "Skills", "skills", {
    kind: "open-skills",
  }),
];

export function createSidebarNavigationRows(
  panelEntries: readonly PluginNavPanelChromeEntry[],
): SidebarNavigationRow[] {
  return [
    ...HOST_ROWS,
    ...panelEntries.map((entry): SidebarNavigationRow => {
      const { chrome } = entry;
      const isAutomations = chrome.pluginId === AUTOMATIONS_PLUGIN_ID;
      return {
        pluginId: isAutomations ? "__bb__" : chrome.pluginId,
        id: isAutomations ? "automations" : chrome.id,
        label: chrome.title,
        icon: { kind: "plugin", pluginId: chrome.pluginId, icon: chrome.icon },
        action: {
          kind: "open-plugin-panel",
          pluginId: chrome.pluginId,
          panelId: chrome.id,
        },
        ownerPluginId: chrome.pluginId,
        panelEntry: entry,
      };
    }),
  ];
}

export function getSidebarNavigationRowContent(
  row: SidebarNavigationRow,
): PaneContent | null {
  if (row.action.kind === "new-thread") return NEW_THREAD_CONTENT;
  if (row.action.kind !== "open-plugin-panel") return null;
  const chrome = row.panelEntry?.chrome;
  return chrome
    ? {
        kind: "plugin-panel",
        pluginId: chrome.pluginId,
        panelPath: chrome.path,
        subPath: "",
      }
    : null;
}

export interface SidebarNavigationItemState {
  isDisabled: boolean;
  isVisible: boolean;
  shortcut: ExperimentalSidebarNavigationShortcut | null;
  accessory: ComponentType | null;
}

export function toSidebarNavigationItem(
  row: SidebarNavigationRow,
  state: SidebarNavigationItemState,
): ExperimentalSidebarNavigationItem {
  return {
    id: getPluginNavPanelKey(row),
    label: row.label,
    icon: row.icon,
    action: row.action,
    isDisabled: state.isDisabled,
    isVisible: state.isVisible,
    isLoading: row.panelEntry !== null && row.panelEntry.panel === null,
    pluginId: row.ownerPluginId,
    shortcut: state.shortcut,
    experimental_Accessory: state.accessory,
  };
}

function sameIcon(
  left: ExperimentalSidebarNavigationIcon,
  right: ExperimentalSidebarNavigationIcon,
): boolean {
  if (left.kind === "host" || right.kind === "host") {
    return (
      left.kind === right.kind &&
      left.kind === "host" &&
      right.kind === "host" &&
      left.name === right.name
    );
  }
  return left.pluginId === right.pluginId && left.icon === right.icon;
}

function sameAction(
  left: ExperimentalSidebarNavigationAction,
  right: ExperimentalSidebarNavigationAction,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "open-plugin-panel" || right.kind !== "open-plugin-panel") {
    return true;
  }
  return left.pluginId === right.pluginId && left.panelId === right.panelId;
}

export function isSameSidebarNavigationItem(
  left: ExperimentalSidebarNavigationItem,
  right: ExperimentalSidebarNavigationItem,
): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    sameIcon(left.icon, right.icon) &&
    sameAction(left.action, right.action) &&
    left.isDisabled === right.isDisabled &&
    left.isVisible === right.isVisible &&
    left.isLoading === right.isLoading &&
    left.pluginId === right.pluginId &&
    left.shortcut?.label === right.shortcut?.label &&
    left.shortcut?.ariaKeyShortcuts === right.shortcut?.ariaKeyShortcuts &&
    left.experimental_Accessory === right.experimental_Accessory
  );
}

export function resolveActiveSidebarNavigationItemId({
  rows,
  pathname,
}: {
  rows: readonly SidebarNavigationRow[];
  pathname: string;
}): string | null {
  if (pathname === "/") return NEW_THREAD_NAVIGATION_ITEM_ID;
  if (isToolsRoutePath(pathname)) {
    return pathname === getSkillsRoutePath() ||
      pathname.startsWith(`${getSkillsRoutePath()}/`)
      ? SKILLS_NAVIGATION_ITEM_ID
      : PLUGINS_NAVIGATION_ITEM_ID;
  }
  for (const row of rows) {
    const chrome = row.panelEntry?.chrome;
    if (!chrome) continue;
    const path = getPluginPanelRoutePath({
      pluginId: chrome.pluginId,
      path: chrome.path,
    });
    if (pathname === path || pathname.startsWith(`${path}/`)) {
      return getPluginNavPanelKey(row);
    }
  }
  return null;
}

export function getResourceNavigationRoutePath(
  action: ExperimentalSidebarNavigationAction,
): string | null {
  if (action.kind === "open-extensions") return getPluginsRoutePath();
  if (action.kind === "open-skills") return getSkillsRoutePath();
  return null;
}
