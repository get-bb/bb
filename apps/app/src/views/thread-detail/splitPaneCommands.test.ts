import { describe, expect, it } from "vitest";
import type { LayoutNode, PaneNode } from "@/lib/split-layout";
import { getAdjacentPaneId, getDirectionalPaneId } from "./splitPaneCommands";

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

describe("spatial split navigation", () => {
  const root: LayoutNode = {
    type: "split",
    dir: "row",
    sizes: [0.4, 0.6],
    children: [
      pane("left"),
      {
        type: "split",
        dir: "col",
        sizes: [0.3, 0.7],
        children: [pane("top"), pane("bottom")],
      },
    ],
  };

  it("follows geometry across nested and unequal splits", () => {
    expect(getDirectionalPaneId(root, "left", "right")).toBe("bottom");
    expect(getDirectionalPaneId(root, "bottom", "top")).toBe("top");
    expect(getDirectionalPaneId(root, "top", "bottom")).toBe("bottom");
    expect(getDirectionalPaneId(root, "top", "left")).toBe("left");
    expect(getDirectionalPaneId(root, "bottom", "left")).toBe("left");
  });

  it("does not wrap, jump diagonally, or navigate a missing or single pane", () => {
    expect(getDirectionalPaneId(root, "top", "top")).toBeNull();
    expect(getDirectionalPaneId(root, "bottom", "right")).toBeNull();
    expect(getDirectionalPaneId(root, "left", "bottom")).toBeNull();
    expect(getDirectionalPaneId(root, "missing", "right")).toBeNull();
    expect(getDirectionalPaneId(pane("only"), "only", "right")).toBeNull();
  });
});
