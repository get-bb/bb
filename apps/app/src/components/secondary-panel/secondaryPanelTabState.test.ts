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
  buildOrderedSecondaryPanelFileTabs,
  closeSecondaryPanelTabInState,
  openSecondaryPanelTabInState,
  replaceNewTabWithSecondaryPanelTabInState,
} from "./secondaryPanelTabState";

function makeWorkspaceTab(environmentId: string) {
  return createWorkspaceFilePreviewFixedPanelTab({
    environmentId,
    projectId: null,
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
      environmentId: "env-1",
      tab: {
        lineRange: null,
        path: "/tmp/log.txt",
      },
      threadId: "thr-1",
    });
    const tabs = [
      createThreadInfoFixedPanelTab(),
      createGitDiffFixedPanelTab(),
      workspaceTab,
      hostTab,
      createThreadStorageFilePreviewFixedPanelTab({
        environmentId: "env-1",
        isPinned: false,
        tab: { lineRange: null, path: "artifact.txt" },
        threadId: "thr-1",
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
      environmentId: "env-1",
      tab: {
        lineRange: null,
        path: "/tmp/first.txt",
      },
      threadId: "thr-1",
    });
    const secondTab = createHostFilePreviewFixedPanelTab({
      environmentId: "env-1",
      tab: {
        lineRange: null,
        path: "/tmp/second.txt",
      },
      threadId: "thr-1",
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
      environmentId: "env-1",
      tab: {
        lineRange: null,
        path: "/tmp/only.txt",
      },
      threadId: "thr-1",
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
      environmentId: "env-1",
      tab: {
        lineRange: null,
        path: "/tmp/active.txt",
      },
      threadId: "thr-1",
    });
    const inactiveTab = createHostFilePreviewFixedPanelTab({
      environmentId: "env-1",
      tab: {
        lineRange: null,
        path: "/tmp/inactive.txt",
      },
      threadId: "thr-1",
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

  it("can keep workspace tabs visible outside the current environment", () => {
    const firstTab = makeWorkspaceTab("env-1");
    const secondTab = makeWorkspaceTab("env-2");

    expect(
      buildOrderedSecondaryPanelFileTabs({
        includeWorkspaceTabsOutsideEnvironment: true,
        resolvedEnvironmentId: "env-2",
        tabs: [firstTab, secondTab],
      }).map((tab) => tab.id),
    ).toEqual([firstTab.id, secondTab.id]);
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
