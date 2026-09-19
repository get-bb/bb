import { describe, expect, it } from "vitest";
import {
  MAX_PANES,
  countPanes,
  findPane,
  findPaneByContent,
  isNewThreadComposerPane,
  replaceWithNewThreadComposer,
  findPaneByThread,
  listPanes,
  movePane,
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

function layoutAtPaneCount(count: number): SplitLayout {
  let layout = singlePaneLayout();
  for (let index = 2; index <= count; index += 1) {
    layout = splitPane(
      layout,
      layout.focusedPaneId,
      "right",
      threadContent(`thread-${index}`),
    );
  }
  return layout;
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
    const feasibleMinimum = Math.min(0.15, 1 / node.children.length);
    for (const size of node.sizes) {
      expect(size).toBeGreaterThanOrEqual(feasibleMinimum);
      expect(size).toBeLessThanOrEqual(0.85);
    }
    node.children.forEach(visit);
  }
  visit(layout.root);
}

describe("split layout operations", () => {
  it("rebalances seven successive default-right opens into eight equal usable panes", () => {
    const eight = layoutAtPaneCount(MAX_PANES);

    expect(eight.root).toMatchObject({
      type: "split",
      dir: "row",
      children: Array.from({ length: MAX_PANES }, () => ({ type: "pane" })),
    });
    if (eight.root.type !== "split") {
      throw new Error("Expected a flat row split");
    }
    expect(eight.root.sizes).toHaveLength(MAX_PANES);
    for (const size of eight.root.sizes) {
      expect(size).toBeCloseTo(1 / MAX_PANES, 12);
    }
    expect(
      splitPane(eight, eight.focusedPaneId, "right", threadContent("thread-9")),
    ).toBe(eight);
  });

  it("inserts in reading order, focuses the new pane, and enforces the cap", () => {
    const two = splitPane(
      singlePaneLayout(),
      "pane-1",
      "left",
      threadContent("thread-2", "project-2"),
    );
    const three = splitPane(two, "pane-1", "bottom", threadContent("thread-3"));
    const four = splitPane(three, "pane-3", "right", threadContent("thread-4"));
    let eight = four;
    for (let index = 5; index <= MAX_PANES; index += 1) {
      eight = splitPane(
        eight,
        eight.focusedPaneId,
        index % 2 === 0 ? "right" : "bottom",
        threadContent(`thread-${index}`),
      );
    }
    const rejected = splitPane(
      eight,
      "pane-1",
      "top",
      threadContent("thread-9"),
    );

    expect(listPanes(two.root).map((item) => item.paneId)).toEqual([
      "pane-2",
      "pane-1",
    ]);
    expect(two.focusedPaneId).toBe("pane-2");
    expect(listPanes(eight.root).map((item) => item.paneId)).toEqual([
      "pane-2",
      "pane-1",
      "pane-3",
      "pane-4",
      "pane-5",
      "pane-6",
      "pane-7",
      "pane-8",
    ]);
    expect(countPanes(eight.root)).toBe(MAX_PANES);
    expect(eight.focusedPaneId).toBe("pane-8");
    expect(rejected).toBe(eight);
    expect(findPaneByThread(two.root, "project-2", "thread-2")?.paneId).toBe(
      "pane-2",
    );
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
    const three = splitPane(two, "pane-2", "bottom", threadContent("thread-3"));
    const removedMiddle = removePane(three, "pane-2");
    const removedEnd = removePane(setFocus(removedMiddle, "pane-3"), "pane-3");

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
    const eight = layoutAtPaneCount(MAX_PANES);
    const before = findPane(eight.root, "pane-8");
    const moved = movePane(eight, "pane-8", "pane-7", "left");
    const after = findPane(moved.root, "pane-8");

    expect(countPanes(moved.root)).toBe(MAX_PANES);
    expect(after).toBe(before);
    expect(after?.content).toBe(before?.content);
    expect(moved.focusedPaneId).toBe("pane-8");
    expectValidFocus(moved);
    expect(movePane(moved, "pane-8", "pane-8", "right")).toBe(moved);
  });

  it("keeps focus, resizing, rearrangement, and closing usable at eight panes", () => {
    const eight = layoutAtPaneCount(MAX_PANES);
    const focused = setFocus(eight, "pane-5");
    const resized = resizeSplit(focused, [], 0, 0.7);
    const swapped = swapPanes(resized, "pane-5", "pane-6");
    const closed = removePane(swapped, "pane-6");

    expect(focused.focusedPaneId).toBe("pane-5");
    expect(resized).not.toBe(focused);
    expect(swapped.focusedPaneId).toBe("pane-6");
    expect(countPanes(closed.root)).toBe(MAX_PANES - 1);
    expect(findPane(closed.root, "pane-6")).toBeNull();
    expectValidFocus(closed);
    expectNormalizedSizes(closed);
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
});

describe("independent composer identity", () => {
  it("keeps whole composer nodes through moves, swaps, and collapse", () => {
    const first = splitPane(singlePaneLayout(), "pane-1", "right", {
      kind: "new-thread",
    });
    const firstId = first.focusedPaneId;
    const second = splitPane(first, firstId, "bottom", { kind: "new-thread" });
    const secondId = second.focusedPaneId;
    const firstNode = findPane(second.root, firstId);
    const secondNode = findPane(second.root, secondId);
    const moved = movePane(second, firstId, "pane-1", "left");
    const swapped = swapPanes(moved, firstId, secondId);
    expect(findPane(swapped.root, firstId)).toBe(firstNode);
    expect(findPane(swapped.root, secondId)).toBe(secondNode);
    expect(swapped.focusedPaneId).toBe(firstId);
    const mixedSwap = swapPanes(swapped, "pane-1", firstId);
    expect(findPane(mixedSwap.root, firstId)).toBe(firstNode);
    const collapsed = removePane(removePane(mixedSwap, "pane-1"), secondId);
    expect(collapsed.root).toBe(firstNode);
  });

  it("never deduplicates explicit composers or reuses their IDs for ordinary panes", () => {
    const first = splitPane(singlePaneLayout(), "pane-1", "right", {
      kind: "new-thread",
    });
    const firstId = first.focusedPaneId;
    const second = splitPane(first, firstId, "right", { kind: "new-thread" });
    expect(second.focusedPaneId).not.toBe(firstId);
    expect(findPaneByContent(second.root, { kind: "new-thread" })).toBeNull();
    expect(listPanes(second.root).filter(isNewThreadComposerPane)).toHaveLength(
      2,
    );
    const removed = removePane(second, firstId);
    const ordinary = splitPane(
      removed,
      "pane-1",
      "left",
      threadContent("later"),
    );
    expect(ordinary.focusedPaneId).toBe("pane-2");
    const singleton = replacePaneContent(ordinary, second.focusedPaneId, {
      kind: "new-thread",
    });
    expect(singleton.focusedPaneId).toBe("pane-3");
    expect(
      findPaneByContent(singleton.root, { kind: "new-thread" })?.paneId,
    ).toBe("pane-3");
  });

  it("allocates a fresh composer for replacement at the pane limit", () => {
    const eight = layoutAtPaneCount(MAX_PANES);
    const first = replaceWithNewThreadComposer(eight, eight.focusedPaneId);
    const next = replaceWithNewThreadComposer(first, first.focusedPaneId);
    expect(countPanes(next.root)).toBe(MAX_PANES);
    expect(next.focusedPaneId).not.toBe(first.focusedPaneId);
    expect(findPane(next.root, first.focusedPaneId)).toBeNull();
  });
});
