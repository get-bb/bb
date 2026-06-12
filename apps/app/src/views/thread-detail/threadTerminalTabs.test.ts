import type { TerminalSession } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  createHostFilePreviewFixedPanelTab,
  createTerminalFixedPanelTab,
  type SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  buildTerminalSyncedSecondaryFileTabs,
  findActiveTerminalIdInSecondaryFileTabs,
} from "./threadTerminalTabs";

type TerminalSessionOverrides = Partial<TerminalSession>;

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

function tabIds(tabs: readonly SecondaryFileFixedPanelTab[]): string[] {
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

    expect(tabIds(tabs)).toEqual(["terminal:term_1", "terminal:term_2"]);
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
      "terminal:term_2",
      "host-file-preview:%2Fworkspace%2Ffile.ts",
      "terminal:term_1",
      "terminal:term_3",
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

    expect(tabIds(tabs)).toEqual(["terminal:term_1"]);
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
});
