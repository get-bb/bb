import { describe, expect, it } from "vitest";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createGitDiffFixedPanelTab,
  createHostFilePreviewFixedPanelTab,
  createNewTabFixedPanelTab,
  createSideChatFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  activateSecondaryPanelTabInState,
  closeSecondaryPanelTabInState,
  openSecondaryPanelTabInState,
  replaceNewTabWithSecondaryPanelTabInState,
} from "./secondaryPanelTabState";

function makeWorkspaceTab(environmentId: string) {
  return createWorkspaceFilePreviewFixedPanelTab({
    environmentId,
    tab: {
      lineRange: null,
      path: "src/index.ts",
      source: { kind: "working-tree" },
      statusLabel: null,
    },
  });
}

describe("secondaryPanelTabState", () => {
  it("opens, activates, and closes secondary panel tabs by canonical id", () => {
    const workspaceTab = makeWorkspaceTab("env-1");
    const hostTab = createHostFilePreviewFixedPanelTab({
      lineRange: null,
      path: "/tmp/log.txt",
    });
    const tabs = [
      createThreadInfoFixedPanelTab(),
      createGitDiffFixedPanelTab(),
      workspaceTab,
      hostTab,
      createThreadStorageFilePreviewFixedPanelTab({
        isPinned: false,
        tab: { lineRange: null, path: "artifact.txt" },
      }),
      createBrowserFixedPanelTab({ environmentId: "env-1", url: "" }),
      createNewTabFixedPanelTab(),
      createTerminalFixedPanelTab({ terminalId: "term-1" }),
    ];
    let state = createEmptyFixedPanelTabsState();

    for (const tab of tabs) {
      state = openSecondaryPanelTabInState({ state, tab });
    }

    expect(state.secondary.isOpen).toBe(true);
    expect(state.secondary.tabs.map((tab) => tab.id)).toEqual(
      tabs.map((tab) => tab.id),
    );

    state = activateSecondaryPanelTabInState(state, workspaceTab.id);
    expect(state.secondary.activeTabId).toBe(workspaceTab.id);

    state = closeSecondaryPanelTabInState(state, workspaceTab.id);
    expect(state.secondary.activeTabId).toBe(hostTab.id);
    expect(state.secondary.tabs.some((tab) => tab.id === workspaceTab.id)).toBe(
      false,
    );
  });

  it("activates the previous file tab when closing the last active file tab", () => {
    const firstTab = createHostFilePreviewFixedPanelTab({
      lineRange: null,
      path: "/tmp/first.txt",
    });
    const secondTab = createHostFilePreviewFixedPanelTab({
      lineRange: null,
      path: "/tmp/second.txt",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: secondTab.id,
        isOpen: true,
        tabs: [createThreadInfoFixedPanelTab(), firstTab, secondTab],
      },
    });

    const nextState = closeSecondaryPanelTabInState(state, secondTab.id);

    expect(nextState.secondary.activeTabId).toBe(firstTab.id);
    expect(nextState.secondary.tabs.map((tab) => tab.id)).toEqual([
      createThreadInfoFixedPanelTab().id,
      firstTab.id,
    ]);
  });

  it("clears active state when closing the only active file tab", () => {
    const fileTab = createHostFilePreviewFixedPanelTab({
      lineRange: null,
      path: "/tmp/only.txt",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: fileTab.id,
        isOpen: true,
        tabs: [createThreadInfoFixedPanelTab(), fileTab],
      },
    });

    const nextState = closeSecondaryPanelTabInState(state, fileTab.id);

    expect(nextState.secondary.activeTabId).toBeNull();
    expect(nextState.secondary.tabs.map((tab) => tab.id)).toEqual([
      createThreadInfoFixedPanelTab().id,
    ]);
  });

  it("keeps the active tab when closing an inactive file tab", () => {
    const activeTab = createHostFilePreviewFixedPanelTab({
      lineRange: null,
      path: "/tmp/active.txt",
    });
    const inactiveTab = createHostFilePreviewFixedPanelTab({
      lineRange: null,
      path: "/tmp/inactive.txt",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: activeTab.id,
        isOpen: true,
        tabs: [activeTab, inactiveTab],
      },
    });

    const nextState = closeSecondaryPanelTabInState(state, inactiveTab.id);

    expect(nextState.secondary.activeTabId).toBe(activeTab.id);
    expect(nextState.secondary.tabs.map((tab) => tab.id)).toEqual([
      activeTab.id,
    ]);
  });

  it("does not collide workspace tabs for the same path in different environments", () => {
    const firstTab = makeWorkspaceTab("env-1");
    const secondTab = makeWorkspaceTab("env-2");
    let state = createEmptyFixedPanelTabsState();

    state = openSecondaryPanelTabInState({ state, tab: firstTab });
    state = openSecondaryPanelTabInState({ state, tab: secondTab });

    expect(firstTab.id).not.toBe(secondTab.id);
    expect(state.secondary.tabs).toHaveLength(2);
  });

  it("replaces the transient new tab when selecting another tab", () => {
    const newTab = createNewTabFixedPanelTab();
    const workspaceTab = makeWorkspaceTab("env-1");
    let state = createEmptyFixedPanelTabsState();

    state = openSecondaryPanelTabInState({ state, tab: newTab });
    state = replaceNewTabWithSecondaryPanelTabInState({
      state,
      tab: workspaceTab,
    });

    expect(state.secondary.activeTabId).toBe(workspaceTab.id);
    expect(state.secondary.tabs.map((tab) => tab.id)).toEqual([
      workspaceTab.id,
    ]);
  });

  it("replaces the transient new tab when starting a side chat", () => {
    const newTab = createNewTabFixedPanelTab();
    const sideChatTab = createSideChatFixedPanelTab({
      sourceMessageText: "",
      title: "Side chat",
    });
    let state = createEmptyFixedPanelTabsState();

    state = openSecondaryPanelTabInState({ state, tab: newTab });
    state = replaceNewTabWithSecondaryPanelTabInState({
      state,
      tab: sideChatTab,
    });

    expect(state.secondary.activeTabId).toBe(sideChatTab.id);
    expect(state.secondary.tabs.map((tab) => tab.id)).toEqual([
      sideChatTab.id,
    ]);
  });
});
