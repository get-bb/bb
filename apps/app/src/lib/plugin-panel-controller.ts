import type {
  ExperimentalOpenTabOptions,
  ExperimentalPanelController,
  ExperimentalPanelTabs,
  ExperimentalTabReference,
  JsonValue,
} from "@get-bb/plugin-sdk";
import {
  getPluginFixedTabOwnerId,
  getThreadFixedTabOwnerId,
  type AppPanelController,
} from "@/lib/app-fixed-tab-navigation";
import type { AppTabOpenIntent } from "@/lib/app-navigation-host";

const NO_PANEL_TABS: ExperimentalPanelTabs = {
  open: false,
  selectedKey: null,
  tabs: [],
};

function toAppTabIntent(
  pluginId: string,
  options: ExperimentalOpenTabOptions,
): AppTabOpenIntent {
  const { tab } = options;
  return {
    tab: {
      ownerId:
        tab.context.kind === "thread"
          ? getThreadFixedTabOwnerId(pluginId)
          : getPluginFixedTabOwnerId(pluginId, tab.context.panelId),
      tabId: tab.id,
    },
    availability: tab.availability,
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.params === undefined ? {} : { params: options.params }),
    ...(options.title === undefined ? {} : { title: options.title }),
  };
}

export function createPluginPanelController(
  pluginId: string,
  getController: () => AppPanelController | null,
): ExperimentalPanelController {
  return {
    openTab: (options) =>
      getController()?.openTab(toAppTabIntent(pluginId, options)) ?? false,
    toggleTab: (options) =>
      getController()?.toggleTab(toAppTabIntent(pluginId, options)) ?? false,
    getTabs: () => getController()?.getTabs() ?? NO_PANEL_TABS,
    selectTab: (key) => getController()?.selectTab(key) ?? false,
    closeTab: (key) => getController()?.closeTab(key) ?? false,
    close: () => getController()?.close() ?? false,
  };
}

export interface RetiredPanelOpenOptions {
  actionId?: string;
  title?: string;
  params?: JsonValue;
}

export function createRetiredOpenPanel(
  panel: ExperimentalPanelController,
  ownTab?: ExperimentalTabReference & { availability: "action" },
) {
  return (options?: RetiredPanelOpenOptions): boolean => {
    const id = ownTab?.id ?? options?.actionId;
    if (typeof id !== "string") return false;
    return panel.openTab({
      tab: ownTab ?? {
        id,
        context: { kind: "thread" },
        availability: "action",
      },
      ...(options?.title === undefined ? {} : { title: options.title }),
      ...(options?.params === undefined ? {} : { params: options.params }),
    });
  };
}

export function withRetiredAppPanelMembers(panel: ExperimentalPanelController) {
  return {
    ...panel,
    experimental_openTab: (options: ExperimentalOpenTabOptions) =>
      panel.openTab(options),
    openFixedTab: (options: {
      tab: { id: string; panelId?: string };
      target?: JsonValue;
    }) => {
      const { panelId, id } = options.tab;
      if (panelId === undefined && options.target !== undefined) return false;
      return panel.openTab({
        tab: {
          id,
          context:
            panelId === undefined
              ? { kind: "thread" }
              : { kind: "nav-panel", panelId },
          availability: "fixed",
        },
        ...(options.target === undefined ? {} : { target: options.target }),
      });
    },
  };
}
