import type { ThreadTab } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createEmptyFixedPanelTabsState } from "./fixed-panel-tabs-state";
import { reconcileFixedPanelTabsState } from "./thread-tabs-sync";

function browserTab(id: string, title: string): ThreadTab {
  return {
    environmentId: null,
    id: `browser:${id}:none`,
    kind: "browser",
    title,
    url: `https://${id}.example.com`,
  };
}

describe("thread tab synchronization", () => {
  it("preserves local presentation state while adopting remote tabs", () => {
    const first = browserTab("first", "First");
    const second = browserTab("second", "Second");
    const current = createEmptyFixedPanelTabsState({
      lastUsedAt: 123,
      secondary: {
        activeTabId: first.id,
        isOpen: true,
        tabs: [first],
      },
    });

    const withBoth = reconcileFixedPanelTabsState(current, [first, second]);
    expect(withBoth).toMatchObject({
      lastUsedAt: 123,
      secondary: { activeTabId: first.id, isOpen: true },
    });
    expect(withBoth.secondary.tabs).toEqual([first, second]);

    const withoutActive = reconcileFixedPanelTabsState(withBoth, [second]);
    expect(withoutActive).toMatchObject({
      lastUsedAt: 123,
      secondary: { activeTabId: null, isOpen: true },
    });
  });
});
