import { describe, expect, it } from "vitest";
import {
  MAX_PANES,
  countPanes,
  findPane,
  findPaneByThread,
  listPanes,
  movePane,
  normalize,
  removePane,
  replacePaneContent,
  resizeSplit,
  setFocus,
  splitPane,
  swapPanes,
} from "./ops";
import type { PaneContent, PaneNode, SplitLayout } from "./types";

function threadContent(threadId: string, projectId = "project-1"): PaneContent {
  return { kind: "thread", projectId, threadId };
}

function pane(paneId: string, threadId = paneId): PaneNode {
  return { type: "pane", paneId, content: threadContent(threadId) };
}

function singlePaneLayout(): SplitLayout {
  return { root: pane("pane-1"), focusedPaneId: "pane-1" };
}

function expectValidFocus(layout: SplitLayout): void {
  expect(findPane(layout.root, layout.focusedPaneId)).not.toBeNull();
}

function expectNormalizedSizes(layout: SplitLayout): void {
  function visit(node: SplitLayout["root"]): void {
    if (node.type === "pane") {
      return;
    }
    expect(node.sizes).toHaveLength(node.children.length);
    expect(node.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1, 12);
    for (const size of node.sizes) {
      expect(size).toBeGreaterThanOrEqual(0.15);
      expect(size).toBeLessThanOrEqual(0.85);
    }
    node.children.forEach(visit);
  }
  visit(layout.root);
}

describe("split layout operations", () => {
  it("inserts in reading order, focuses the new pane, and enforces the cap", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "left",
      threadContent("thread-2", "project-2"),
    );
    const three = splitPane(
      two,
      "pane-1",
      "bottom",
      threadContent("thread-3"),
    );
    const four = splitPane(
      three,
      "pane-3",
      "right",
      threadContent("thread-4"),
    );
    const rejected = splitPane(
      four,
      "pane-1",
      "top",
      threadContent("thread-5"),
    );

    expect(listPanes(two.root).map((item) => item.paneId)).toEqual([
      "pane-2",
      "pane-1",
    ]);
    expect(two.focusedPaneId).toBe("pane-2");
    expect(countPanes(four.root)).toBe(MAX_PANES);
    expect(rejected).toBe(four);
    expect(
      findPaneByThread(two.root, "project-2", "thread-2")?.paneId,
    ).toBe("pane-2");
  });

  it("replaces and swaps content while applying the reference focus semantics", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "right",
      threadContent("thread-2"),
    );
    const replacement = threadContent("replacement", "project-2");
    const replaced = replacePaneContent(two, "pane-1", replacement);
    const swapped = swapPanes(replaced, "pane-1", "pane-2");

    expect(replaced.focusedPaneId).toBe("pane-1");
    expect(findPane(swapped.root, "pane-2")?.content).toBe(replacement);
    expect(findPane(swapped.root, "pane-1")?.content).toEqual(
      threadContent("thread-2"),
    );
    expect(swapped.focusedPaneId).toBe("pane-2");
  });

  it("removes panes, collapses single-child splits, and selects the nearest focus", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "right",
      threadContent("thread-2"),
    );
    const three = splitPane(
      two,
      "pane-2",
      "bottom",
      threadContent("thread-3"),
    );
    const removedMiddle = removePane(three, "pane-2");
    const removedEnd = removePane(
      setFocus(removedMiddle, "pane-3"),
      "pane-3",
    );

    expect(listPanes(removedMiddle.root).map((item) => item.paneId)).toEqual([
      "pane-1",
      "pane-3",
    ]);
    expect(removedMiddle.root).toMatchObject({
      type: "split",
      dir: "row",
      children: [{ type: "pane" }, { type: "pane" }],
    });
    expect(removedMiddle.focusedPaneId).toBe("pane-3");
    expect(removedEnd.root.type).toBe("pane");
    expect(removedEnd.focusedPaneId).toBe("pane-1");
    expect(removePane(removedEnd, "pane-1")).toBe(removedEnd);
    expectValidFocus(removedMiddle);
    expectValidFocus(removedEnd);
  });

  it("moves a pane at the cap without changing its ID or content identity", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "right",
      threadContent("thread-2"),
    );
    const three = splitPane(
      two,
      "pane-2",
      "bottom",
      threadContent("thread-3"),
    );
    const four = splitPane(
      three,
      "pane-1",
      "bottom",
      threadContent("thread-4"),
    );
    const before = findPane(four.root, "pane-4");
    const moved = movePane(four, "pane-4", "pane-3", "left");
    const after = findPane(moved.root, "pane-4");

    expect(countPanes(moved.root)).toBe(MAX_PANES);
    expect(after).toBe(before);
    expect(after?.content).toBe(before?.content);
    expect(moved.focusedPaneId).toBe("pane-4");
    expectValidFocus(moved);
    expect(movePane(moved, "pane-4", "pane-4", "right")).toBe(moved);
  });

  it("resizes adjacent pairs with clamped fractions and unit split totals", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "right",
      threadContent("thread-2"),
    );
    const low = resizeSplit(two, [], 0, -10);
    const high = resizeSplit(low, [], 0, 10);

    if (low.root.type === "split") {
      expect(low.root.sizes[0]).toBeCloseTo(0.15, 12);
      expect(low.root.sizes[1]).toBeCloseTo(0.85, 12);
    }
    if (high.root.type === "split") {
      expect(high.root.sizes[0]).toBeCloseTo(0.85, 12);
      expect(high.root.sizes[1]).toBeCloseTo(0.15, 12);
      expect(high.root.sizes.reduce((sum, size) => sum + size, 0)).toBe(1);
    }
    expect(resizeSplit(high, [], 1, 0.5)).toBe(high);
    expect(resizeSplit(high, [0], 0, 0.5)).toBe(high);
  });

  it("normalizes degenerate trees, invalid sizes, excess panes, and focus", () => {
    const malformed: SplitLayout = {
      root: {
        type: "split",
        dir: "row",
        sizes: [Number.NaN, -1],
        children: [
          {
            type: "split",
            dir: "col",
            sizes: [7],
            children: [pane("pane-1")],
          },
          {
            type: "split",
            dir: "col",
            sizes: [99, 1, 1, 1],
            children: [
              pane("pane-2"),
              pane("pane-3"),
              pane("pane-4"),
              pane("pane-5"),
            ],
          },
        ],
      },
      focusedPaneId: "missing-pane",
    };

    const normalized = normalize(malformed);

    expect(countPanes(normalized.root)).toBe(MAX_PANES);
    expect(listPanes(normalized.root).map((item) => item.paneId)).toEqual([
      "pane-1",
      "pane-2",
      "pane-3",
      "pane-4",
    ]);
    expect(normalized.focusedPaneId).toBe("pane-1");
    expectNormalizedSizes(normalized);
    expectValidFocus(normalized);
  });
});
