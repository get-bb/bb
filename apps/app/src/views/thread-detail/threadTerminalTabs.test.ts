import type { TerminalSession } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  createEmptyFixedPanelTabsState,
  createHostFilePreviewFixedPanelTab,
  createTerminalFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  buildTerminalSyncedSecondaryFileTabs,
  findActiveTerminalIdInSecondaryFileTabs,
  syncTerminalTabsInFixedPanelState,
} from "./threadTerminalTabs";

type TerminalSessionOverrides = Partial<TerminalSession>;

interface TabIdentity {
  id: string;
}

function terminalSession(
  overrides: TerminalSessionOverrides,
): TerminalSession {
  return {
    id: "term_1",
    threadId: "thr_1",
    environmentId: "env_1",
    hostId: "host_1",
    title: "Terminal",
    initialCwd: "/workspace",
    cols: 100,
    rows: 30,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

function tabIds(tabs: readonly TabIdentity[]): string[] {
  return tabs.map((tab) => tab.id);
}

describe("buildTerminalSyncedSecondaryFileTabs", () => {
  it("adds server terminal sessions missing from local tabs", () => {
    const tabs = buildTerminalSyncedSecondaryFileTabs({
      orderedTabs: [],
      terminalSessions: [
        terminalSession({ id: "term_1" }),
        terminalSession({ id: "term_2" }),
      ],
    });

    expect(tabIds(tabs)).toEqual([
      "terminal:term_1:none",
      "terminal:term_2:none",
    ]);
  });

  it("preserves local terminal tab order when sessions still exist", () => {
    const localTerminal2 = createTerminalFixedPanelTab({
      terminalId: "term_2",
    });
    const localFile = createHostFilePreviewFixedPanelTab({
      lineRange: null,
      path: "/workspace/file.ts",
    });
    const localTerminal1 = createTerminalFixedPanelTab({
      terminalId: "term_1",
    });
    const tabs = buildTerminalSyncedSecondaryFileTabs({
      orderedTabs: [localTerminal2, localFile, localTerminal1],
      terminalSessions: [
        terminalSession({ id: "term_1" }),
        terminalSession({ id: "term_2" }),
        terminalSession({ id: "term_3" }),
      ],
    });

    expect(tabIds(tabs)).toEqual([
      "terminal:term_2:none",
      "host-file-preview:%2Fworkspace%2Ffile.ts:none",
      "terminal:term_1:none",
      "terminal:term_3:none",
    ]);
  });

  it("drops stale local terminal tabs when sessions disappear elsewhere", () => {
    const tabs = buildTerminalSyncedSecondaryFileTabs({
      orderedTabs: [
        createTerminalFixedPanelTab({ terminalId: "term_stale" }),
        createTerminalFixedPanelTab({ terminalId: "term_1" }),
      ],
      terminalSessions: [terminalSession({ id: "term_1" })],
    });

    expect(tabIds(tabs)).toEqual(["terminal:term_1:none"]);
  });

  it("finds the active terminal id only for displayed terminal tabs", () => {
    const terminalTab = createTerminalFixedPanelTab({ terminalId: "term_1" });
    const fileTab = createHostFilePreviewFixedPanelTab({
      lineRange: null,
      path: "/workspace/file.ts",
    });

    expect(
      findActiveTerminalIdInSecondaryFileTabs({
        activeTabId: terminalTab.id,
        tabs: [fileTab, terminalTab],
      }),
    ).toBe("term_1");
    expect(
      findActiveTerminalIdInSecondaryFileTabs({
        activeTabId: fileTab.id,
        tabs: [fileTab, terminalTab],
      }),
    ).toBeNull();
    expect(
      findActiveTerminalIdInSecondaryFileTabs({
        activeTabId: "terminal:term_stale",
        tabs: [fileTab, terminalTab],
      }),
    ).toBeNull();
  });

  it("syncs missing server terminal sessions into fixed panel state", () => {
    const fileTab = createHostFilePreviewFixedPanelTab({
      lineRange: null,
      path: "/workspace/file.ts",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: fileTab.id,
        isOpen: true,
        tabs: [fileTab],
      },
    });
    const nextState = syncTerminalTabsInFixedPanelState({
      state,
      terminalSessions: [
        terminalSession({ id: "term_1" }),
        terminalSession({ id: "term_2" }),
      ],
    });

    expect(tabIds(nextState.secondary.tabs)).toEqual([
      "host-file-preview:%2Fworkspace%2Ffile.ts:none",
      "terminal:term_1:none",
      "terminal:term_2:none",
    ]);
    expect(nextState.secondary.activeTabId).toBe(fileTab.id);
  });

  it("removes stale fixed terminal tabs and clears stale active state", () => {
    const staleTerminalTab = createTerminalFixedPanelTab({
      terminalId: "term_stale",
    });
    const currentTerminalTab = createTerminalFixedPanelTab({
      terminalId: "term_1",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: staleTerminalTab.id,
        isOpen: true,
        tabs: [staleTerminalTab, currentTerminalTab],
      },
    });
    const nextState = syncTerminalTabsInFixedPanelState({
      state,
      terminalSessions: [terminalSession({ id: "term_1" })],
    });

    expect(tabIds(nextState.secondary.tabs)).toEqual([
      "terminal:term_1:none",
    ]);
    expect(nextState.secondary.activeTabId).toBeNull();
  });

  it("keeps fixed panel state identity when terminal tabs already match", () => {
    const terminalTab = createTerminalFixedPanelTab({ terminalId: "term_1" });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: terminalTab.id,
        isOpen: true,
        tabs: [terminalTab],
      },
    });

    expect(
      syncTerminalTabsInFixedPanelState({
        state,
        terminalSessions: [terminalSession({ id: "term_1" })],
      }),
    ).toBe(state);
  });
});
