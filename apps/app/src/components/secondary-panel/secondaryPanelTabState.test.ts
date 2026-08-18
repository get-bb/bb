import { describe, expect, it } from "vitest";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createGitDiffFixedPanelTab,
  createHostFilePreviewFixedPanelTab,
  createNewTabFixedPanelTab,
  createPluginPageFixedPanelTab,
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
  reconcileFixedPanelViewTabsInState,
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

  it("activates a remaining fixed tab when closing the last content tab", () => {
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

    expect(nextState.secondary.activeTabId).toBe(
      createThreadInfoFixedPanelTab().id,
    );
    expect(nextState.secondary.tabs.map((tab) => tab.id)).toEqual([
      createThreadInfoFixedPanelTab().id,
    ]);
    expect(nextState.secondary.isOpen).toBe(true);
  });

  it("reconciles every surface's fixed tabs ahead of closable content", () => {
    const infoTab = createThreadInfoFixedPanelTab();
    const diffTab = createGitDiffFixedPanelTab();
    const contentTab = makeWorkspaceTab("env-1");
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: contentTab.id,
        isOpen: true,
        tabs: [contentTab, infoTab],
      },
    });

    const nextState = reconcileFixedPanelViewTabsInState({
      fixedTabs: [infoTab, diffTab],
      state,
    });

    expect(nextState.secondary).toEqual({
      activeTabId: contentTab.id,
      isOpen: true,
      tabs: [infoTab, diffTab, contentTab],
    });
  });

  it("opens the first plugin-page fixed tab only on first initialization", () => {
    const navigationTab = createPluginPageFixedPanelTab({
      fixedTabId: "navigation",
      pageId: "tasks",
      pluginId: "tasks",
    });
    const initial = reconcileFixedPanelViewTabsInState({
      fixedTabs: [navigationTab],
      openFirstFixedTabWhenEmpty: true,
      state: createEmptyFixedPanelTabsState(),
    });

    expect(initial.secondary).toEqual({
      activeTabId: navigationTab.id,
      isOpen: true,
      tabs: [navigationTab],
    });

    const hidden = {
      ...initial,
      secondary: { ...initial.secondary, isOpen: false },
    };
    expect(
      reconcileFixedPanelViewTabsInState({
        fixedTabs: [navigationTab],
        openFirstFixedTabWhenEmpty: true,
        state: hidden,
      }),
    ).toBe(hidden);
  });

  it("falls back through the shared fixed-tab order when one disappears", () => {
    const firstTab = createPluginPageFixedPanelTab({
      fixedTabId: "navigation",
      pageId: "docs",
      pluginId: "docs",
    });
    const secondTab = createPluginPageFixedPanelTab({
      fixedTabId: "outline",
      pageId: "docs",
      pluginId: "docs",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: firstTab.id,
        isOpen: true,
        tabs: [firstTab, secondTab],
      },
    });

    const nextState = reconcileFixedPanelViewTabsInState({
      fixedTabs: [secondTab],
      state,
    });

    expect(nextState.secondary).toEqual({
      activeTabId: secondTab.id,
      isOpen: true,
      tabs: [secondTab],
    });
  });

  it("retains an active Diff tab until eligibility is authoritative", () => {
    const infoTab = createThreadInfoFixedPanelTab();
    const diffTab = createGitDiffFixedPanelTab();
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: diffTab.id,
        isOpen: true,
        tabs: [infoTab, diffTab],
      },
    });

    const whileLoading = reconcileFixedPanelViewTabsInState({
      fixedTabs: [infoTab, diffTab],
      state,
    });
    expect(whileLoading).toBe(state);

    const onceIneligible = reconcileFixedPanelViewTabsInState({
      fixedTabs: [infoTab],
      state,
    });
    expect(onceIneligible.secondary).toEqual({
      activeTabId: infoTab.id,
      isOpen: true,
      tabs: [infoTab],
    });
  });

  it("closes the panel and removes its sole New tab launcher", () => {
    const newTab = createNewTabFixedPanelTab();
    const state = openSecondaryPanelTabInState({
      state: createEmptyFixedPanelTabsState(),
      tab: newTab,
    });

    const nextState = closeSecondaryPanelTabInState(state, newTab.id);

    expect(nextState.secondary).toEqual({
      activeTabId: null,
      isOpen: false,
      tabs: [],
    });
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

  it("replaces the transient new tab when opening a browser tab", () => {
    const newTab = createNewTabFixedPanelTab();
    const browserTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://example.com",
    });
    let state = createEmptyFixedPanelTabsState();

    state = openSecondaryPanelTabInState({ state, tab: newTab });
    state = replaceNewTabWithSecondaryPanelTabInState({
      state,
      tab: browserTab,
    });

    expect(state.secondary.activeTabId).toBe(browserTab.id);
    expect(state.secondary.tabs.map((tab) => tab.id)).toEqual([browserTab.id]);
  });
});
