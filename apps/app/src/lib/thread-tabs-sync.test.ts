import { openSecondaryPanelTabInState } from "@bb/client-core";
import type { ThreadTab } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  createEmptyFixedPanelTabsState,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
} from "./fixed-panel-tabs-state";
import { createPluginPageFixedPanelTab } from "./fixed-panel-tabs-state";
import {
  areThreadTabListsEquivalent,
  mergeThreadTabChanges,
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
  it("preserves remote additions and edits when removing a local tab", () => {
    const source = browserTab("source", "Source");
    const updatedSource = { ...source, title: "Updated elsewhere" };
    const detour = browserTab("detour", "Detour");
    const remote = browserTab("remote", "Remote");
    expect(
      mergeThreadTabChanges(
        [updatedSource, detour, remote],
        [source, detour],
        [source],
      ),
    ).toEqual([updatedSource, remote]);
  });

  it("inserts a replacement without restoring other remotely closed tabs", () => {
    const source = browserTab("source", "Source");
    const placeholder = browserTab("placeholder", "Placeholder");
    const neighbor = browserTab("neighbor", "Neighbor");
    const terminal = createTerminalFixedPanelTab({ terminalId: "replacement" });
    expect(
      mergeThreadTabChanges(
        [placeholder, neighbor],
        [source, placeholder, neighbor],
        [source, terminal, neighbor],
      ),
    ).toEqual([terminal, neighbor]);
  });

  it("keeps remote ordering unless the local operation reorders tabs", () => {
    const a = browserTab("a", "A");
    const b = browserTab("b", "B");
    const c = browserTab("c", "C");
    const remote = browserTab("remote", "Remote");
    expect(mergeThreadTabChanges([c, a, b], [a, b, c], [a, c])).toEqual([c, a]);
    expect(
      mergeThreadTabChanges([a, remote, b, c], [a, b, c], [c, a, b]),
    ).toEqual([c, remote, a, b]);
  });

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
      secondary: { activeTabId: second.id, isOpen: true },
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

it("returns to the prior terminal when another client removes the active terminal before its close callback", () => {
  const source = createTerminalFixedPanelTab({ terminalId: "source" });
  const detour = createTerminalFixedPanelTab({ terminalId: "detour" });
  const state = openSecondaryPanelTabInState({
    state: createEmptyFixedPanelTabsState({
      secondary: {
        tabs: [createThreadInfoFixedPanelTab(), source],
        activeTabId: source.id,
        isOpen: true,
      },
    }),
    tab: detour,
  });
  const reconciled = reconcileFixedPanelTabsState(state, [
    createThreadInfoFixedPanelTab(),
    source,
  ]);
  expect(reconciled.secondary.activeTabId).toBe(source.id);
});
