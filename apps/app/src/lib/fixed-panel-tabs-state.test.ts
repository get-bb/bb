import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_FIXED_PANEL_TABS_STATE,
  areFixedPanelTabsEquivalent,
  buildFixedPanelTabId,
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createHostFilePreviewFixedPanelTab,
  createSideChatFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
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
      projectId: null,
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
      projectId: null,
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

describe("workspace file preview fixed panel tabs", () => {
  it("round-trips an active project-source preview tab", () => {
    const projectTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: null,
      projectId: "proj_app",
      tab: {
        lineRange: null,
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: projectTab.id,
        isOpen: true,
        tabs: [projectTab],
      },
      lastUsedAt: NOW,
    });

    const parsed = parseFixedPanelTabsState({
      initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
      now: NOW,
      storedValue: serializeFixedPanelTabsState({ state }),
    });

    expect(parsed.secondary.activeTabId).toBe(projectTab.id);
    expect(parsed.secondary.tabs).toEqual([projectTab]);
  });

  it("does not collide project-source preview tabs for the same path in different projects", () => {
    const firstProjectTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: null,
      projectId: "proj_first",
      tab: {
        lineRange: null,
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const secondProjectTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: null,
      projectId: "proj_second",
      tab: {
        lineRange: null,
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });

    expect(firstProjectTab.id).not.toBe(secondProjectTab.id);
    expect(
      areFixedPanelTabsEquivalent(firstProjectTab, secondProjectTab),
    ).toBe(false);
  });
});

describe("thread-owned file preview fixed panel tabs", () => {
  it("round-trips active host and storage preview tabs with their owner thread", () => {
    const hostTab = createHostFilePreviewFixedPanelTab({
      environmentId: "env_app",
      tab: {
        lineRange: null,
        path: "/tmp/log.txt",
      },
      threadId: "thr_app",
    });
    const storageTab = createThreadStorageFilePreviewFixedPanelTab({
      environmentId: "env_app",
      isPinned: false,
      tab: {
        lineRange: null,
        path: "artifact.txt",
      },
      threadId: "thr_app",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: storageTab.id,
        isOpen: true,
        tabs: [hostTab, storageTab],
      },
      lastUsedAt: NOW,
    });

    const parsed = parseFixedPanelTabsState({
      initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
      now: NOW,
      storedValue: serializeFixedPanelTabsState({ state }),
    });

    expect(parsed.secondary.activeTabId).toBe(storageTab.id);
    expect(parsed.secondary.tabs).toEqual([hostTab, storageTab]);
  });

  it("does not collide host or storage preview tabs for the same path in different threads", () => {
    const firstHostTab = createHostFilePreviewFixedPanelTab({
      environmentId: "env_first",
      tab: {
        lineRange: null,
        path: "/tmp/log.txt",
      },
      threadId: "thr_first",
    });
    const secondHostTab = createHostFilePreviewFixedPanelTab({
      environmentId: "env_second",
      tab: {
        lineRange: null,
        path: "/tmp/log.txt",
      },
      threadId: "thr_second",
    });
    const firstStorageTab = createThreadStorageFilePreviewFixedPanelTab({
      environmentId: "env_first",
      isPinned: false,
      tab: {
        lineRange: null,
        path: "artifact.txt",
      },
      threadId: "thr_first",
    });
    const secondStorageTab = createThreadStorageFilePreviewFixedPanelTab({
      environmentId: "env_second",
      isPinned: false,
      tab: {
        lineRange: null,
        path: "artifact.txt",
      },
      threadId: "thr_second",
    });

    expect(firstHostTab.id).not.toBe(secondHostTab.id);
    expect(firstStorageTab.id).not.toBe(secondStorageTab.id);
    expect(areFixedPanelTabsEquivalent(firstHostTab, secondHostTab)).toBe(false);
    expect(
      areFixedPanelTabsEquivalent(firstStorageTab, secondStorageTab),
    ).toBe(false);
  });

  it("keeps legacy ownerless host and storage preview tabs parseable", () => {
    const state = {
      version: FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
      secondary: {
        activeTabId: "thread-storage-file-preview:artifact.txt:none",
        isOpen: true,
        tabs: [
          {
            id: "host-file-preview:%2Ftmp%2Flog.txt:none",
            kind: "host-file-preview",
            lineRange: null,
            path: "/tmp/log.txt",
          },
          {
            id: "thread-storage-file-preview:artifact.txt:none",
            isPinned: false,
            kind: "thread-storage-file-preview",
            lineRange: null,
            path: "artifact.txt",
          },
        ],
      },
      lastUsedAt: NOW,
    };

    const parsed = parseFixedPanelTabsState({
      initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
      now: NOW,
      storedValue: JSON.stringify(state),
    });

    expect(parsed.secondary.tabs).toMatchObject([
      {
        environmentId: null,
        kind: "host-file-preview",
        threadId: null,
      },
      {
        environmentId: null,
        kind: "thread-storage-file-preview",
        threadId: null,
      },
    ]);
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
