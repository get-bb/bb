import { describe, expect, it } from "vitest";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createGitDiffFixedPanelTab,
  createHostFilePreviewFixedPanelTab,
  createNewTabFixedPanelTab,
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
    const tabs = [
      createThreadInfoFixedPanelTab(),
      createGitDiffFixedPanelTab(),
      makeWorkspaceTab("env-1"),
      createHostFilePreviewFixedPanelTab({
        lineRange: null,
        path: "/tmp/log.txt",
      }),
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

    const workspaceTab = tabs[2];
    expect(workspaceTab).toBeDefined();
    if (!workspaceTab) return;

    state = activateSecondaryPanelTabInState(state, workspaceTab.id);
    expect(state.secondary.activeTabId).toBe(workspaceTab.id);

    state = closeSecondaryPanelTabInState(state, workspaceTab.id);
    expect(state.secondary.activeTabId).toBeNull();
    expect(state.secondary.tabs.some((tab) => tab.id === workspaceTab.id)).toBe(
      false,
    );
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
});
