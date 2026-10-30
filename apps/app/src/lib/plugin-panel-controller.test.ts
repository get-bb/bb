import { describe, expect, it, vi } from "vitest";
import { UNAVAILABLE_APP_PANEL_CONTROLLER } from "./app-fixed-tab-navigation";
import type { AppTabOpenIntent } from "./app-navigation-host";
import { createPluginPanelController } from "./plugin-panel-controller";

const chatTab = {
  id: "chat",
  context: { kind: "thread" },
  availability: "action",
} as const;
const ownTab = { pluginId: "demo", tabId: "plugin-panel:demo:chat" };

function controllerIn(callerTab: { pluginId: string; tabId: string } | null) {
  const openTab = vi.fn((_intent: AppTabOpenIntent) => true);
  const toggleTab = vi.fn((_intent: AppTabOpenIntent) => true);
  const panel = { ...UNAVAILABLE_APP_PANEL_CONTROLLER, openTab, toggleTab };
  return {
    openTab,
    toggleTab,
    plugin: createPluginPanelController("demo", () => panel, callerTab),
  };
}

describe("createPluginPanelController", () => {
  it("turns experimental_replace into the plugin's own calling tab", () => {
    const { openTab, plugin } = controllerIn(ownTab);
    expect(
      plugin.openTab({
        tab: chatTab,
        params: { n: 2 },
        title: "Two",
        experimental_replace: true,
      }),
    ).toBe(true);
    expect(openTab).toHaveBeenCalledExactlyOnceWith({
      tab: { ownerId: "plugin-thread:demo", tabId: "chat" },
      availability: "action",
      params: { n: 2 },
      title: "Two",
      replaceTabId: ownTab.tabId,
    });
  });

  it.each([
    ["outside a plugin tab", null],
    [
      "inside another plugin's tab",
      { pluginId: "other", tabId: "plugin-panel:other:chat" },
    ],
  ])("declines experimental_replace %s", (_name, callerTab) => {
    const { openTab, toggleTab, plugin } = controllerIn(callerTab);
    const options = {
      tab: chatTab,
      params: { n: 2 },
      experimental_replace: true,
    } as const;
    expect(plugin.openTab(options)).toBe(false);
    expect(plugin.toggleTab(options)).toBe(false);
    expect(openTab).not.toHaveBeenCalled();
    expect(toggleTab).not.toHaveBeenCalled();
  });

  it("never replaces without the flag, even from its own tab", () => {
    const { openTab, plugin } = controllerIn(ownTab);
    plugin.openTab({ tab: chatTab, params: { n: 2 } });
    expect(openTab).toHaveBeenCalledExactlyOnceWith({
      tab: { ownerId: "plugin-thread:demo", tabId: "chat" },
      availability: "action",
      params: { n: 2 },
    });
  });
});
