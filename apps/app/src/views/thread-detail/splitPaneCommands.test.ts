import { describe, expect, it } from "vitest";
import type { PaneNode } from "@/lib/split-layout";
import {
  getAdjacentPaneId,
  getPaneIdAtReadingIndex,
} from "./splitPaneCommands";

function pane(paneId: string): PaneNode {
  return {
    type: "pane",
    paneId,
    content: { kind: "thread", projectId: "project-1", threadId: paneId },
  };
}

const PANES = [pane("pane-1"), pane("pane-2"), pane("pane-3")];

describe("split pane shortcut selection", () => {
  it("cycles in reading order and wraps in both directions", () => {
    expect(getAdjacentPaneId(PANES, "pane-1", 1)).toBe("pane-2");
    expect(getAdjacentPaneId(PANES, "pane-3", 1)).toBe("pane-1");
    expect(getAdjacentPaneId(PANES, "pane-1", -1)).toBe("pane-3");
  });

  it("does not select an adjacent pane when unsplit", () => {
    expect(getAdjacentPaneId([PANES[0]!], "pane-1", 1)).toBeNull();
  });

  it("focuses only pane numbers that exist", () => {
    expect(getPaneIdAtReadingIndex(PANES, 0)).toBe("pane-1");
    expect(getPaneIdAtReadingIndex(PANES, 2)).toBe("pane-3");
    expect(getPaneIdAtReadingIndex(PANES, 3)).toBeNull();
  });
});
