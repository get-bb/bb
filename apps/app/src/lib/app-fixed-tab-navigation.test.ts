import { describe, expect, it, vi } from "vitest";
import {
  createAppPanelController,
  type AppFixedTabDestination,
} from "./app-fixed-tab-navigation";
import type { AppTabOpenIntent } from "./app-navigation-host";

const fixedTab = { ownerId: "plugin:demo:tasks", tabId: "details" };
const actionTab = { ownerId: "plugin-thread:demo", tabId: "chat" };

function createSurface(activeTabId: string | null) {
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
    activeTabId,
    close,
    destinations,
  }));
  return { close, openAction, openFixed, panel };
}

describe("createAppPanelController", () => {
  it("opens a fixed tab with its target and an action tab with params and title", () => {
    const { openAction, openFixed, panel } = createSurface(null);
    expect(
      panel.openTab({
        tab: fixedTab,
        availability: "fixed",
        target: { recordId: "issue-42" },
      }),
    ).toBe(true);
    expect(
      panel.openTab({
        tab: actionTab,
        availability: "action",
        params: { threadId: "t" },
        title: "Chat",
      }),
    ).toBe(true);
    expect(openFixed).toHaveBeenCalledWith({ recordId: "issue-42" });
    expect(openAction).toHaveBeenCalledWith(undefined, {
      params: { threadId: "t" },
      title: "Chat",
    });
  });

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
    [
      "a tab of another owner",
      {
        tab: { ownerId: "plugin:other:tasks", tabId: "details" },
        availability: "fixed",
      },
    ],
    ["the wrong availability", { tab: fixedTab, availability: "action" }],
  ])("declines %s without touching the surface", (_label, intent) => {
    const { close, openAction, openFixed, panel } = createSurface(null);
    expect(panel.openTab(intent)).toBe(false);
    expect(panel.toggleTab(intent)).toBe(false);
    expect(openFixed).not.toHaveBeenCalled();
    expect(openAction).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("toggles a showing fixed tab closed whatever the target", () => {
    const { close, openFixed, panel } = createSurface("fixed-details");
    expect(
      panel.toggleTab({ tab: fixedTab, availability: "fixed", target: 7 }),
    ).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(openFixed).not.toHaveBeenCalled();
  });

  it("toggles an action tab closed only when the instance with the same params is selected", () => {
    const { close, openAction, panel } = createSurface('chat:{"id":1}');
    panel.toggleTab({
      tab: actionTab,
      availability: "action",
      params: { id: 2 },
    });
    expect(openAction).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    panel.toggleTab({
      tab: actionTab,
      availability: "action",
      params: { id: 1 },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("opens through toggle when the panel shows another tab or is closed", () => {
    const { close, openFixed, panel } = createSurface("chat:null");
    expect(panel.toggleTab({ tab: fixedTab, availability: "fixed" })).toBe(
      true,
    );
    expect(openFixed).toHaveBeenCalledWith(undefined);
    expect(close).not.toHaveBeenCalled();
    expect(panel.close()).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});
