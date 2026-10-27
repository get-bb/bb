import { describe, expect, it, vi } from "vitest";
import {
  createAppPanelController,
  type AppFixedTabDestination,
} from "./app-fixed-tab-navigation";
import type { AppTabOpenIntent } from "./app-navigation-host";

const fixedTab = { ownerId: "plugin:demo:tasks", tabId: "details" };
const actionTab = { ownerId: "plugin-thread:demo", tabId: "chat" };

function createSurface() {
  const openFixed = vi.fn(() => true);
  const openAction = vi.fn(() => true);
  const close = vi.fn();
  const destinations: AppFixedTabDestination[] = [
    { tab: fixedTab, open: openFixed, panelTabId: () => "fixed-details" },
    {
      tab: actionTab,
      availability: "action",
      open: openAction,
      panelTabId: (params) => `chat:${JSON.stringify(params ?? null)}`,
    },
  ];
  const panel = createAppPanelController(() => ({
    activeTabId: null,
    close,
    destinations,
  }));
  return { close, openAction, openFixed, panel };
}

describe("createAppPanelController", () => {
  it.each<[string, AppTabOpenIntent]>([
    [
      "params on a fixed tab",
      { tab: fixedTab, availability: "fixed", params: 1 },
    ],
    [
      "a target on an action tab",
      { tab: actionTab, availability: "action", target: 1 },
    ],
    [
      "a non-JSON target",
      {
        tab: fixedTab,
        availability: "fixed",
        target: { at: new Date() } as never,
      },
    ],
  ])("declines %s without touching the surface", (_label, intent) => {
    const { close, openAction, openFixed, panel } = createSurface();
    expect(panel.openTab(intent)).toBe(false);
    expect(panel.toggleTab(intent)).toBe(false);
    expect(openFixed).not.toHaveBeenCalled();
    expect(openAction).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
