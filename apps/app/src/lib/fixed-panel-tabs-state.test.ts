import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_FIXED_PANEL_TABS_STATE,
  areFixedPanelTabsEquivalent,
  buildFixedPanelTabId,
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createSideChatFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  isFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  serializeFixedPanelTabsState,
  FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
  type FixedPanelTabsState,
  type SideChatFixedPanelTab,
} from "./fixed-panel-tabs-state";

const NOW = 1_700_000_000_000;

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

describe("side-chat fixed panel tabs", () => {
  it("does not require crypto.randomUUID for generated tab ids", () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
      randomUUID: undefined,
      subtle: originalCrypto.subtle,
    });

    try {
      const sideChatTab = createSideChatFixedPanelTab({
        sourceMessageText: "",
        title: "Side chat",
      });
      const browserTab = createBrowserFixedPanelTab({
        environmentId: null,
        url: "",
      });

      expect(sideChatTab.id).toMatch(/^side-chat:/);
      expect(browserTab.id).toMatch(/^browser:.+:none$/);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });

  it("round-trips side-chat tabs (threadId null and set)", () => {
    const pendingTab = createSideChatFixedPanelTab({
      sourceMessageText: "Why this index? Full source agent message text.",
      sourceSeqEnd: 12,
      title: "Why this index?",
    });
    const createdTab: SideChatFixedPanelTab = {
      ...createSideChatFixedPanelTab({
        sourceMessageText: "Created side chat source message.",
        sourceSeqEnd: 18,
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

  it("round-trips a side-chat tab opened from the thread tip", () => {
    const tab = createSideChatFixedPanelTab({
      sourceMessageText: "",
      sourceSeqEnd: null,
      title: "Side chat",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        tabs: [tab],
        activeTabId: tab.id,
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
