import { describe, expect, it } from "vitest";
import {
  createEmptyFixedPanelTabsState,
  createGitDiffFixedPanelTab,
  createPluginFixedPanelTab,
  createThreadInfoFixedPanelTab,
  type FixedPanelTab,
  type FixedPanelTabsState,
} from "./fixed-panel-tabs-state";
import { restoredLazyParts } from "./restored-lazy-parts";

function panel(tab: FixedPanelTab, isOpen = true): FixedPanelTabsState {
  return createEmptyFixedPanelTabsState({
    secondary: { tabs: [tab], activeTabId: tab.id, isOpen },
  });
}

function panelAction(): FixedPanelTab {
  return {
    actionId: "review",
    id: "plugin-panel:reviewer:review",
    kind: "plugin-panel",
    paramsJson: null,
    pluginId: "reviewer",
    title: "Review",
  };
}

describe("restoredLazyParts", () => {
  it.each([
    {
      name: "a plugin's settings page",
      pathname: "/settings/plugins/connect",
      state: null,
      parts: [{ kind: "settings-page", pluginId: "connect" }],
    },
    {
      name: "a plugin's own page",
      pathname: "/plugins/automations/automations/browse",
      state: null,
      parts: [
        {
          kind: "nav-panel-page",
          pluginId: "automations",
          path: "automations",
        },
      ],
    },
    {
      name: "a thread with Git's Diff tab open",
      pathname: "/projects/proj_a/threads/thr_a",
      state: panel(createGitDiffFixedPanelTab()),
      parts: [{ kind: "panel-tab", pluginId: "bb--git", tabId: "diff" }],
    },
    {
      name: "a projectless thread with a plugin tab open",
      pathname: "/threads/thr_a",
      state: panel(
        createPluginFixedPanelTab({ pluginId: "notes", tabId: "pad" }),
      ),
      parts: [{ kind: "panel-tab", pluginId: "notes", tabId: "pad" }],
    },
    {
      name: "a thread with the Info tab open",
      pathname: "/projects/proj_a/threads/thr_a",
      state: panel(createThreadInfoFixedPanelTab()),
      parts: [{ kind: "info-tab" }],
    },
    {
      name: "a thread with a plugin panel action open",
      pathname: "/projects/proj_a/threads/thr_a",
      state: panel(panelAction()),
      parts: [
        { kind: "panel-action", pluginId: "reviewer", actionId: "review" },
      ],
    },
    {
      name: "a thread whose panel is closed",
      pathname: "/projects/proj_a/threads/thr_a",
      state: panel(createGitDiffFixedPanelTab(), false),
      parts: [],
    },
    {
      name: "the home page",
      pathname: "/",
      state: null,
      parts: [],
    },
  ])("lists what $name shows", ({ pathname, state, parts }) => {
    expect(
      restoredLazyParts(pathname, (threadId) => {
        expect(threadId).toBe("thr_a");
        return state ?? createEmptyFixedPanelTabsState();
      }),
    ).toEqual(parts);
  });
});
