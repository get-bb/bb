import { describe, expect, it } from "vitest";
import {
  EMPTY_FIXED_PANEL_TABS_STATE,
  areFixedPanelTabsEquivalent,
  buildFixedPanelTabId,
  createEmptyFixedPanelTabsState,
  createSideChatFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  parseFixedPanelTabsState,
  serializeFixedPanelTabsState,
  type FixedPanelTabsState,
  type SideChatFixedPanelTab,
} from "./fixed-panel-tabs-state";

const NOW = 1_700_000_000_000;

function makeInitialState(): FixedPanelTabsState {
  return {
    version: 1,
    secondary: {
      tabs: [],
      activeTabId: null,
      isOpen: false,
    },
    bottom: {
      tabs: [],
      activeTabId: null,
    },
    lastUsedAt: 0,
  };
}

describe("fixed-panel-tabs-state", () => {
  it("migrates legacy secondary tab ids together with the active id", () => {
    const now = 1_000;
    const workspaceTab = {
      environmentId: "env-1",
      id: "workspace-file-preview:src%2Findex.ts",
      kind: "workspace-file-preview",
      lineRange: null,
      path: "src/index.ts",
      source: { kind: "working-tree" },
      statusLabel: null,
    };
    const storedState = {
      version: 1,
      secondary: {
        tabs: [
          { id: "thread-info", kind: "thread-info" },
          workspaceTab,
          {
            id: "browser:browser-instance",
            kind: "browser",
            title: null,
            url: "",
          },
        ],
        activeTabId: workspaceTab.id,
        isOpen: true,
      },
      bottom: {
        tabs: [
          { id: "terminal:term-1", kind: "terminal", terminalId: "term-1" },
        ],
        activeTabId: "terminal:term-1",
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
        kind: "browser",
        path: "browser-instance",
      }),
      buildFixedPanelTabId({
        environmentId: null,
        kind: "terminal",
        path: "term-1",
      }),
    ]);
    expect(parsed.bottom.tabs).toEqual([]);
  });
});

describe("side-chat fixed panel tabs", () => {
  it("round-trips side-chat tabs (threadId null and set)", () => {
    const pendingTab = createSideChatFixedPanelTab({
      sourceMessageText: "Why this index? Full source agent message text.",
      title: "Why this index?",
    });
    const createdTab: SideChatFixedPanelTab = {
      ...createSideChatFixedPanelTab({
        sourceMessageText: "Created side chat source message.",
        title: "Created side chat",
      }),
      threadId: "thr_side_child",
    };
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        tabs: [pendingTab, createdTab],
        activeTabId: pendingTab.id,
        isOpen: true,
      },
      lastUsedAt: NOW,
    });

    expect(
      parseFixedPanelTabsState({
        initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
        now: NOW,
        storedValue: serializeFixedPanelTabsState({ state }),
      }),
    ).toEqual(state);
  });

  it("treats a side-chat threadId change as a non-equivalent update", () => {
    const pendingTab = createSideChatFixedPanelTab({
      sourceMessageText: "Side chat source message.",
      title: "Side chat",
    });
    const createdTab: SideChatFixedPanelTab = {
      ...pendingTab,
      threadId: "thr_side_child",
    };
    expect(areFixedPanelTabsEquivalent(pendingTab, pendingTab)).toBe(true);
    expect(areFixedPanelTabsEquivalent(pendingTab, createdTab)).toBe(false);
  });
});
