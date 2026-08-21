import { describe, expect, it } from "vitest";
import {
  removeFixedRightTerminalTabInState,
  upsertTerminalTab,
} from "./fixed-panel-tabs";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
} from "./fixed-panel-tabs-state";

describe("plugin right-panel Terminal tabs", () => {
  it("preserves the explicit target when selecting a sibling session", () => {
    const target = {
      kind: "environment" as const,
      environmentId: "env_tasks",
    };

    expect(upsertTerminalTab([], "term_2", target)).toEqual([
      expect.objectContaining({ terminalId: "term_2", target }),
    ]);
  });

  it("selects the following sibling when an active Terminal is removed", () => {
    const before = createPluginPanelFixedPanelTab({
      actionId: "navigation",
      paramsJson: null,
      pluginId: "tasks",
      title: "Navigation",
    });
    const terminal = createTerminalFixedPanelTab({ terminalId: "term_2" });
    const after = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://example.com",
    });

    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: terminal.id,
        isOpen: true,
        tabs: [before, terminal, after],
      },
    });

    expect(
      removeFixedRightTerminalTabInState(state, terminal.terminalId).secondary
        .activeTabId,
    ).toBe(after.id);
  });

  it("closes the panel when the last active Terminal is removed", () => {
    const terminal = createTerminalFixedPanelTab({ terminalId: "term_2" });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: terminal.id,
        isOpen: true,
        tabs: [terminal],
      },
    });

    const nextState = removeFixedRightTerminalTabInState(
      state,
      terminal.terminalId,
    );

    expect(nextState.secondary).toEqual({
      activeTabId: null,
      isOpen: false,
      tabs: [],
    });
  });
});
