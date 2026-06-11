// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_FIXED_PANEL_TABS_STATE,
  FIXED_PANEL_TABS_IDLE_EXPIRY_MS,
  createAppFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createNewTabFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  normalizeFixedPanelTabsState,
  parseFixedPanelTabsState,
  pruneFixedPanelTabsStorage,
  serializeFixedPanelTabsState,
  type FixedPanelTabsState,
  type WorkspaceFilePreviewFixedPanelTab,
} from "./fixed-panel-tabs-state";

const NOW = 1_700_000_000_000;

afterEach(() => {
  window.localStorage.clear();
});

function workspaceFileTabId(path: string): string {
  return `workspace-file-preview:${encodeURIComponent(path)}`;
}

function storageFileTabId(path: string): string {
  return `thread-storage-file-preview:${encodeURIComponent(path)}`;
}

function hostFileTabId(path: string): string {
  return `host-file-preview:${encodeURIComponent(path)}`;
}

function appTabId(appId: string): string {
  return `app:${encodeURIComponent(appId)}`;
}

function terminalTabId(terminalId: string): string {
  return `terminal:${encodeURIComponent(terminalId)}`;
}

function makeFixedPanelTabsState(
  overrides: Partial<FixedPanelTabsState> = {},
): FixedPanelTabsState {
  return createEmptyFixedPanelTabsState({
    secondary: {
      tabs: [
        { id: "thread-info", kind: "thread-info" },
        { id: "git-diff", kind: "git-diff" },
        {
          environmentId: "env-current",
          id: workspaceFileTabId("src/app.ts"),
          kind: "workspace-file-preview",
          lineRange: { startLineNumber: 12, endLineNumber: 14 },
          path: "src/app.ts",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
        {
          id: terminalTabId("term_1"),
          kind: "terminal",
          terminalId: "term_1",
        },
      ],
      activeTabId: workspaceFileTabId("src/app.ts"),
      isOpen: true,
    },
    bottom: {
      tabs: [],
      activeTabId: null,
    },
    lastUsedAt: NOW,
    ...overrides,
  });
}

describe("fixed panel tabs state storage", () => {
  it("round-trips valid state", () => {
    const state = makeFixedPanelTabsState();
    const restoredState: FixedPanelTabsState = {
      ...state,
      secondary: {
        ...state.secondary,
        tabs: state.secondary.tabs.map((tab) =>
          tab.kind === "workspace-file-preview"
            ? { ...tab, lineRange: null }
            : tab,
        ),
      },
    };
    const storedValue = serializeFixedPanelTabsState({ state });

    expect(
      parseFixedPanelTabsState({
        initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
        now: NOW,
        storedValue,
      }),
    ).toEqual(restoredState);
  });

  it("round-trips app tabs", () => {
    const appTab = createAppFixedPanelTab({ applicationId: "status" });
    const state = makeFixedPanelTabsState({
      secondary: {
        tabs: [appTab],
        activeTabId: appTabId("status"),
        isOpen: true,
      },
    });

    expect(
      parseFixedPanelTabsState({
        initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
        now: NOW,
        storedValue: serializeFixedPanelTabsState({ state }),
      }),
    ).toEqual(state);
  });

  it("normalizes legacy storage tabs without line numbers", () => {
    const path = "notes.md";
    const storageTabId = storageFileTabId(path);
    const storedValue = JSON.stringify({
      version: 1,
      secondary: {
        tabs: [
          {
            id: storageTabId,
            isPinned: false,
            kind: "thread-storage-file-preview",
            lineNumber: 17,
            path,
          },
        ],
        activeTabId: storageTabId,
        isOpen: true,
      },
      bottom: {
        tabs: [],
        activeTabId: null,
      },
      lastUsedAt: NOW,
    });

    expect(
      parseFixedPanelTabsState({
        initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
        now: NOW,
        storedValue,
      }),
    ).toEqual({
      version: 1,
      secondary: {
        tabs: [
          {
            id: storageTabId,
            isPinned: false,
            kind: "thread-storage-file-preview",
            lineRange: null,
            path,
          },
        ],
        activeTabId: storageTabId,
        isOpen: true,
      },
      bottom: {
        tabs: [],
        activeTabId: null,
      },
      lastUsedAt: NOW,
    });
  });

  it("does not persist file preview line targets", () => {
    const workspacePath = "src/app.ts";
    const hostPath = "/Users/me/notes.md";
    const storagePath = "plans/notes.md";
    const state = makeFixedPanelTabsState({
      secondary: {
        tabs: [
          {
            environmentId: "env-current",
            id: workspaceFileTabId(workspacePath),
            kind: "workspace-file-preview",
            lineRange: { startLineNumber: 12, endLineNumber: 14 },
            path: workspacePath,
            source: { kind: "working-tree" },
            statusLabel: null,
          },
          {
            id: hostFileTabId(hostPath),
            kind: "host-file-preview",
            lineRange: { startLineNumber: 27, endLineNumber: 30 },
            path: hostPath,
          },
          {
            id: storageFileTabId(storagePath),
            isPinned: false,
            kind: "thread-storage-file-preview",
            lineRange: { startLineNumber: 34, endLineNumber: 36 },
            path: storagePath,
          },
        ],
        activeTabId: storageFileTabId(storagePath),
        isOpen: true,
      },
    });

    expect(
      parseFixedPanelTabsState({
        initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
        now: NOW,
        storedValue: serializeFixedPanelTabsState({ state }),
      }).secondary.tabs,
    ).toEqual([
      {
        environmentId: "env-current",
        id: workspaceFileTabId(workspacePath),
        kind: "workspace-file-preview",
        lineRange: null,
        path: workspacePath,
        source: { kind: "working-tree" },
        statusLabel: null,
      },
      {
        id: hostFileTabId(hostPath),
        kind: "host-file-preview",
        lineRange: null,
        path: hostPath,
      },
      {
        id: storageFileTabId(storagePath),
        isPinned: false,
        kind: "thread-storage-file-preview",
        lineRange: null,
        path: storagePath,
      },
    ]);
  });

  it("falls back for invalid JSON, invalid shapes, and unsupported regions", () => {
    const validState = makeFixedPanelTabsState();
    const invalidStoredValues = [
      "{",
      JSON.stringify({ version: 1, secondary: null }),
      JSON.stringify({ ...validState, version: 2 }),
      JSON.stringify({ ...validState, lastUsedAt: -1 }),
      JSON.stringify({
        ...validState,
        bottom: {
          tabs: [{ id: "thread-info", kind: "thread-info" }],
          activeTabId: "thread-info",
        },
      }),
      JSON.stringify({
        ...validState,
        secondary: {
          ...validState.secondary,
          tabs: [
            {
              environmentId: "env-current",
              id: workspaceFileTabId("src/app.ts"),
              kind: "workspace-file-preview",
              lineRange: { startLineNumber: 0, endLineNumber: 0 },
              path: "src/app.ts",
              source: { kind: "working-tree" },
              statusLabel: null,
            },
          ],
        },
      }),
    ];

    for (const storedValue of invalidStoredValues) {
      expect(
        parseFixedPanelTabsState({
          initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
          now: NOW,
          storedValue,
        }),
      ).toBe(EMPTY_FIXED_PANEL_TABS_STATE);
    }
  });

  it("expires records after the idle window", () => {
    const state = makeFixedPanelTabsState({
      lastUsedAt: NOW - FIXED_PANEL_TABS_IDLE_EXPIRY_MS - 1,
    });

    expect(
      parseFixedPanelTabsState({
        initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
        now: NOW,
        storedValue: serializeFixedPanelTabsState({ state }),
      }),
    ).toBe(EMPTY_FIXED_PANEL_TABS_STATE);
  });

  it("prunes expired and invalid records without touching unrelated storage", () => {
    const freshKey = getFixedPanelTabsStateStorageKey({
      threadId: "thr-fresh",
    });
    const expiredKey = getFixedPanelTabsStateStorageKey({
      threadId: "thr-expired",
    });
    const invalidKey = getFixedPanelTabsStateStorageKey({
      threadId: "thr-invalid",
    });
    window.localStorage.setItem(
      freshKey,
      serializeFixedPanelTabsState({ state: makeFixedPanelTabsState() }),
    );
    window.localStorage.setItem(
      expiredKey,
      serializeFixedPanelTabsState({
        state: makeFixedPanelTabsState({
          lastUsedAt: NOW - FIXED_PANEL_TABS_IDLE_EXPIRY_MS - 1,
        }),
      }),
    );
    window.localStorage.setItem(invalidKey, "{");
    window.localStorage.setItem("bb.unrelated", "keep");

    pruneFixedPanelTabsStorage({ now: NOW });

    expect(window.localStorage.getItem(freshKey)).not.toBeNull();
    expect(window.localStorage.getItem(expiredKey)).toBeNull();
    expect(window.localStorage.getItem(invalidKey)).toBeNull();
    expect(window.localStorage.getItem("bb.unrelated")).toBe("keep");
  });
});

describe("fixed panel tabs normalization", () => {
  it("dedupes tabs and clears active ids that no longer exist", () => {
    const normalized = normalizeFixedPanelTabsState({
      state: createEmptyFixedPanelTabsState({
        secondary: {
          tabs: [
            { id: "thread-info", kind: "thread-info" },
            { id: "thread-info", kind: "thread-info" },
            {
              environmentId: "env-current",
              id: workspaceFileTabId("src/app.ts"),
              kind: "workspace-file-preview",
              lineRange: { startLineNumber: 12, endLineNumber: 14 },
              path: "src/app.ts",
              source: { kind: "working-tree" },
              statusLabel: null,
            },
            {
              environmentId: "env-current",
              id: workspaceFileTabId("src/app.ts"),
              kind: "workspace-file-preview",
              lineRange: { startLineNumber: 13, endLineNumber: 15 },
              path: "src/app.ts",
              source: { kind: "head" },
              statusLabel: null,
            },
            {
              id: terminalTabId("term_1"),
              kind: "terminal",
              terminalId: "term_1",
            },
          ],
          activeTabId: "missing",
          isOpen: true,
        },
        bottom: {
          tabs: [
            {
              id: terminalTabId("term_1"),
              kind: "terminal",
              terminalId: "term_1",
            },
            {
              id: terminalTabId("term_1"),
              kind: "terminal",
              terminalId: "term_1",
            },
          ],
          activeTabId: null,
        },
        lastUsedAt: NOW,
      }),
    });

    expect(normalized.secondary.tabs).toEqual([
      { id: "thread-info", kind: "thread-info" },
      {
        environmentId: "env-current",
        id: workspaceFileTabId("src/app.ts"),
        kind: "workspace-file-preview",
        lineRange: { startLineNumber: 12, endLineNumber: 14 },
        path: "src/app.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
      {
        id: terminalTabId("term_1"),
        kind: "terminal",
        terminalId: "term_1",
      },
    ]);
    expect(normalized.secondary.activeTabId).toBeNull();
    expect(normalized.secondary.isOpen).toBe(true);
    expect(normalized.bottom.tabs).toEqual([]);
    expect(normalized.bottom.activeTabId).toBeNull();
  });

  it("migrates legacy bottom terminal tabs into the secondary tab group", () => {
    const normalized = normalizeFixedPanelTabsState({
      state: createEmptyFixedPanelTabsState({
        secondary: {
          tabs: [{ id: "thread-info", kind: "thread-info" }],
          activeTabId: null,
          isOpen: false,
        },
        bottom: {
          tabs: [
            {
              id: terminalTabId("term_1"),
              kind: "terminal",
              terminalId: "term_1",
            },
          ],
          activeTabId: terminalTabId("term_1"),
        },
        lastUsedAt: NOW,
      }),
    });

    expect(normalized.secondary.tabs).toEqual([
      { id: "thread-info", kind: "thread-info" },
      {
        id: terminalTabId("term_1"),
        kind: "terminal",
        terminalId: "term_1",
      },
    ]);
    expect(normalized.secondary.activeTabId).toBe(terminalTabId("term_1"));
    expect(normalized.bottom.tabs).toEqual([]);
    expect(normalized.bottom.activeTabId).toBeNull();
  });

  it("preserves the legacy active bottom terminal when it already exists in secondary", () => {
    const terminalTab = {
      id: terminalTabId("term_1"),
      kind: "terminal",
      terminalId: "term_1",
    } as const;
    const normalized = normalizeFixedPanelTabsState({
      state: createEmptyFixedPanelTabsState({
        secondary: {
          tabs: [terminalTab],
          activeTabId: null,
          isOpen: true,
        },
        bottom: {
          tabs: [terminalTab],
          activeTabId: terminalTab.id,
        },
        lastUsedAt: NOW,
      }),
    });

    expect(normalized.secondary.tabs).toEqual([terminalTab]);
    expect(normalized.secondary.activeTabId).toBe(terminalTab.id);
    expect(normalized.bottom.tabs).toEqual([]);
  });

  it("removes transient new tabs from persisted state", () => {
    const searchTab = createNewTabFixedPanelTab();
    const workspaceTab: WorkspaceFilePreviewFixedPanelTab = {
      environmentId: "env-current",
      id: workspaceFileTabId("src/app.ts"),
      kind: "workspace-file-preview",
      lineRange: { startLineNumber: 12, endLineNumber: 14 },
      path: "src/app.ts",
      source: { kind: "working-tree" },
      statusLabel: null,
    };
    const state: FixedPanelTabsState = {
      version: EMPTY_FIXED_PANEL_TABS_STATE.version,
      secondary: {
        tabs: [searchTab, workspaceTab],
        activeTabId: searchTab.id,
        isOpen: true,
      },
      bottom: {
        tabs: [],
        activeTabId: null,
      },
      lastUsedAt: NOW,
    };

    const storedValue = serializeFixedPanelTabsState({ state });

    expect(storedValue).not.toContain("new-tab");
    expect(
      parseFixedPanelTabsState({
        initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
        now: NOW,
        storedValue,
      }),
    ).toEqual({
      ...state,
      secondary: {
        tabs: [{ ...workspaceTab, lineRange: null }],
        activeTabId: null,
        isOpen: true,
      },
    });
  });
});
