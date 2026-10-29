import { useLayoutEffect, type ReactNode } from "react";
import type {
  ExperimentalPanelTabDetail,
  ExperimentalPanelTabs,
  ExperimentalTabContext,
  JsonValue,
} from "@get-bb/plugin-sdk";
import { parsePluginDetailKey } from "@/components/plugin/plugin-detail-key";
import type { SecondaryPanelFixedTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import type { SecondaryPanelRenderableTab } from "@/components/secondary-panel/secondaryPanelTab";
import type { FixedPanelTab } from "@/lib/fixed-panel-tabs-state";

export interface AppPanelTabEntry {
  key: string;
  title: string;
  status: string | null;
  closable: boolean;
  detail: ExperimentalPanelTabDetail;
  icon: ReactNode;
  select(): void;
  close(): void;
}

export interface AppPanelTabsState {
  open: boolean;
  selectedKey: string | null;
  entries: readonly AppPanelTabEntry[];
}

export const EMPTY_APP_PANEL_TABS_STATE: AppPanelTabsState = {
  open: false,
  selectedKey: null,
  entries: [],
};

function parseParams(paramsJson: string | null): JsonValue | null {
  if (paramsJson === null) return null;
  try {
    return JSON.parse(paramsJson) as JsonValue;
  } catch {
    return null;
  }
}

function panelTabDetail(
  tab: FixedPanelTab,
  actionContext: ExperimentalTabContext,
): ExperimentalPanelTabDetail | null {
  switch (tab.kind) {
    case "thread-info":
      return { kind: "info" };
    case "git-diff":
      return null;
    case "plugin-fixed":
      return tab.pluginId === "core" && tab.tabId === "info"
        ? { kind: "info" }
        : {
            kind: "plugin",
            pluginId: tab.pluginId,
            tab: {
              id: tab.tabId,
              context: { kind: "thread" },
              availability: "fixed",
            },
            params: null,
          };
    case "plugin-page-fixed":
      return {
        kind: "plugin",
        pluginId: tab.pluginId,
        tab: {
          id: tab.fixedTabId,
          context: { kind: "nav-panel", panelId: tab.pageId },
          availability: "fixed",
        },
        params: null,
      };
    case "plugin-panel":
      return {
        kind: "plugin",
        pluginId: tab.pluginId,
        tab: {
          id: tab.actionId,
          context: actionContext,
          availability: "action",
        },
        params: parseParams(tab.paramsJson),
      };
    case "plugin-detail":
      return {
        kind: "plugin-details",
        pluginId: parsePluginDetailKey(tab.detailKey).pluginId,
      };
    case "workspace-file-preview":
    case "host-file-preview":
    case "thread-storage-file-preview":
    case "attachment-file-preview":
      return { kind: "file", path: tab.path };
    case "browser":
      return { kind: "browser", url: tab.url };
    case "terminal":
      return { kind: "terminal", terminalId: tab.terminalId };
    case "new-tab":
      return { kind: "new-tab" };
  }
}

export function buildAppPanelTabsState({
  activeTabId,
  actionContext,
  fixedTabs,
  isOpen,
  tabs,
}: {
  activeTabId: string | null;
  actionContext: ExperimentalTabContext;
  fixedTabs: readonly SecondaryPanelFixedTab[];
  isOpen: boolean;
  tabs: readonly SecondaryPanelRenderableTab[];
}): AppPanelTabsState {
  const entries: AppPanelTabEntry[] = [];
  for (const fixed of fixedTabs) {
    const detail = panelTabDetail(fixed.tab, actionContext);
    if (detail === null) continue;
    entries.push({
      key: fixed.tab.id,
      title: fixed.label,
      status: null,
      closable: false,
      detail,
      icon: fixed.leadingVisual,
      select: fixed.onSelect,
      close: () => undefined,
    });
  }
  for (const tab of tabs) {
    const detail = panelTabDetail(tab.tab, actionContext);
    if (detail === null) continue;
    entries.push({
      key: tab.tab.id,
      title: tab.label,
      status: tab.statusLabel,
      closable: tab.isPinned !== true,
      detail,
      icon: tab.leadingVisual,
      select: tab.onSelect,
      close: tab.onClose,
    });
  }
  return {
    open: isOpen,
    selectedKey:
      activeTabId !== null && entries.some(({ key }) => key === activeTabId)
        ? activeTabId
        : null,
    entries,
  };
}

export function toExperimentalPanelTabs(
  state: AppPanelTabsState,
): ExperimentalPanelTabs {
  return {
    open: state.open,
    selectedKey: state.selectedKey,
    tabs: state.entries.map(({ key, title, status, closable, detail }) => ({
      key,
      title,
      status,
      closable,
      detail,
    })),
  };
}

export function AppPanelTabsPublisher({
  publish,
  ...args
}: Parameters<typeof buildAppPanelTabsState>[0] & {
  publish: (state: AppPanelTabsState) => void;
}) {
  const state = buildAppPanelTabsState(args);
  useLayoutEffect(() => {
    publish(state);
  });
  useLayoutEffect(() => () => publish(EMPTY_APP_PANEL_TABS_STATE), [publish]);
  return null;
}
