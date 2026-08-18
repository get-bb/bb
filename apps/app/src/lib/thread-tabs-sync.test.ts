import type { ThreadTab } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createEmptyFixedPanelTabsState } from "./fixed-panel-tabs-state";
import { createPluginPageFixedPanelTab } from "./fixed-panel-tabs-state";
import {
  areThreadTabListsEquivalent,
  reconcileFixedPanelTabsState,
} from "./thread-tabs-sync";

function browserTab(
  id: string,
  title: string,
): Extract<ThreadTab, { kind: "browser" }> {
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

  it("drops legacy native side-chat tabs persisted before their removal", () => {
    const browser = browserTab("first", "First");
    const legacySideChat: ThreadTab = {
      id: "side-chat:legacy",
      kind: "side-chat",
      sourceMessageText: "anchor",
      sourceSeqEnd: null,
      threadId: "thr_legacy",
      title: "Side chat",
    };
    const current = createEmptyFixedPanelTabsState({
      lastUsedAt: 123,
      secondary: { activeTabId: null, isOpen: true, tabs: [] },
    });

    const reconciled = reconcileFixedPanelTabsState(current, [
      browser,
      legacySideChat,
    ]);

    expect(reconciled.secondary.tabs).toEqual([browser]);
  });

  it("keeps plugin page fixed tabs out of thread synchronization", () => {
    const pageTab = createPluginPageFixedPanelTab({
      fixedTabId: "navigation",
      pageId: "tasks",
      pluginId: "tasks",
    });

    expect(areThreadTabListsEquivalent([pageTab], [])).toBe(true);
  });
});
