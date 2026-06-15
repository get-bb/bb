import { describe, expect, it } from "vitest";
import {
  buildFixedPanelTabId,
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  parseFixedPanelTabsState,
  type FixedPanelTabsState,
} from "./fixed-panel-tabs-state";

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
