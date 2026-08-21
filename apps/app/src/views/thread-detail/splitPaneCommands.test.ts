import { describe, expect, it } from "vitest";
import type { PaneNode } from "@/lib/split-layout";
import { getAdjacentPaneId } from "./splitPaneCommands";

function pane(paneId: string): PaneNode {
  return {
    type: "pane",
    paneId,
    content: { kind: "thread", projectId: "project-1", threadId: paneId },
  };
}

const PANES = Array.from({ length: 8 }, (_, index) =>
  pane(`pane-${index + 1}`),
);

describe("split pane shortcut selection", () => {
  it("cycles in reading order and wraps in both directions", () => {
    expect(getAdjacentPaneId(PANES, "pane-1", 1)).toBe("pane-2");
    expect(getAdjacentPaneId(PANES, "pane-8", 1)).toBe("pane-1");
    expect(getAdjacentPaneId(PANES, "pane-1", -1)).toBe("pane-8");
  });

  it("does not select an adjacent pane when unsplit", () => {
    expect(getAdjacentPaneId([PANES[0]!], "pane-1", 1)).toBeNull();
  });
});
