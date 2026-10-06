import { describe, expect, it } from "vitest";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { selectActiveBrowserTab } from "./BrowserTabDeck";

function makeBrowserTab(id: string, url: string): BrowserFixedPanelTab {
  return {
    environmentId: "env-1",
    id,
    kind: "browser",
    title: null,
    url,
  };
}

describe("selectActiveBrowserTab", () => {
  it("selects exactly the active tab out of many persisted tabs", () => {
    const tabs = [
      makeBrowserTab("tab-a", "https://a.example"),
      makeBrowserTab("tab-b", "https://b.example"),
      makeBrowserTab("tab-c", "https://c.example"),
    ];

    const selected = selectActiveBrowserTab(tabs, "tab-b");

    expect(selected).toBe(tabs[1]);
    expect(selected).not.toBe(tabs[0]);
    expect(selected).not.toBe(tabs[2]);
  });

  it("returns null when there is no active browser tab id", () => {
    const tabs = [makeBrowserTab("tab-a", "https://a.example")];

    expect(selectActiveBrowserTab(tabs, null)).toBeNull();
  });

  it("returns null when the active id is not an open browser tab", () => {
    const tabs = [
      makeBrowserTab("tab-a", "https://a.example"),
      makeBrowserTab("tab-b", "https://b.example"),
    ];

    expect(selectActiveBrowserTab(tabs, "tab-missing")).toBeNull();
  });

  it("returns null for an empty tab list regardless of active id", () => {
    expect(selectActiveBrowserTab([], "tab-a")).toBeNull();
    expect(selectActiveBrowserTab([], null)).toBeNull();
  });
});
