import { describe, expect, it } from "vitest";
import {
  buildFixedPanelTabId,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  isFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
  type FixedPanelTabsState,
} from "./fixed-panel-tabs-state";

function makeInitialState(): FixedPanelTabsState {
  return {
    version: FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
    secondary: {
      tabs: [],
      activeTabId: null,
      isOpen: false,
    },
    lastUsedAt: 0,
  };
}

describe("fixed-panel-tabs-state", () => {
  it("parses current secondary tab state", () => {
    const now = 1_000;
    const workspaceTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-1",
      tab: {
        lineRange: {
          startLineNumber: 1,
          endLineNumber: 3,
        },
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const terminalTab = createTerminalFixedPanelTab({ terminalId: "term-1" });
    const storedState = {
      version: FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
      secondary: {
        tabs: [
          createThreadInfoFixedPanelTab(),
          workspaceTab,
          terminalTab,
        ],
        activeTabId: workspaceTab.id,
        isOpen: true,
      },
      bottom: {
        tabs: [],
        activeTabId: null,
      },
      lastUsedAt: now,
    };

    const parsed = parseFixedPanelTabsState({
      initialValue: makeInitialState(),
      now,
      storedValue: JSON.stringify(storedState),
    });
    const expectedWorkspaceTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-1",
      tab: {
        lineRange: null,
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });

    expect(parsed.secondary.activeTabId).toBe(expectedWorkspaceTab.id);
    expect(parsed.secondary.tabs.map((tab) => tab.id)).toEqual([
      createThreadInfoFixedPanelTab().id,
      expectedWorkspaceTab.id,
      buildFixedPanelTabId({
        environmentId: null,
        kind: "terminal",
        path: "term-1",
      }),
    ]);
    expect(parsed.secondary.tabs[1]).toMatchObject({
      lineRange: null,
    });
  });

  it("drops old fixed panel state shapes instead of migrating them", () => {
    const initialValue = makeInitialState();
    const parsed = parseFixedPanelTabsState({
      initialValue,
      now: 1_000,
      storedValue: JSON.stringify({
        version: FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
        secondary: {
          tabs: [{ id: "thread-info", kind: "thread-info" }],
          activeTabId: "thread-info",
        },
        bottom: {
          tabs: [
            { id: "terminal:term-1", kind: "terminal", terminalId: "term-1" },
          ],
          activeTabId: "terminal:term-1",
        },
        lastUsedAt: 1_000,
      }),
    });

    expect(parsed).toBe(initialValue);
  });

  it("recognizes old versioned storage keys for pruning", () => {
    expect(
      isFixedPanelTabsStateStorageKey(
        getFixedPanelTabsStateStorageKey({ threadId: "thr_current" }),
      ),
    ).toBe(true);
    expect(
      isFixedPanelTabsStateStorageKey(
        "bb.thread.fixedPanelTabsState-thr_old-0",
      ),
    ).toBe(true);
  });
});
