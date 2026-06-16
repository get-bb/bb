import { describe, expect, it } from "vitest";
import {
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  type FixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { pruneTerminalTabs } from "./useThreadFileTabs";

describe("pruneTerminalTabs", () => {
  it("removes terminal tabs that no longer have visible sessions", () => {
    const infoTab = createThreadInfoFixedPanelTab();
    const staleTerminalTab = createTerminalFixedPanelTab({
      terminalId: "term_exited",
    });
    const currentTerminalTab = createTerminalFixedPanelTab({
      terminalId: "term_running",
    });
    const tabs: readonly FixedPanelTab[] = [
      infoTab,
      staleTerminalTab,
      currentTerminalTab,
    ];

    const nextTabs = pruneTerminalTabs({
      knownTerminalIds: new Set(["term_running"]),
      tabs,
    });

    expect(nextTabs).toEqual([infoTab, currentTerminalTab]);
  });

  it("preserves tab array identity when every terminal tab is still visible", () => {
    const tabs: readonly FixedPanelTab[] = [
      createThreadInfoFixedPanelTab(),
      createTerminalFixedPanelTab({ terminalId: "term_running" }),
    ];

    const nextTabs = pruneTerminalTabs({
      knownTerminalIds: new Set(["term_running"]),
      tabs,
    });

    expect(nextTabs).toBe(tabs);
  });
});
