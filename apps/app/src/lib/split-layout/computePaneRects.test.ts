import { describe, expect, it } from "vitest";
import { computePaneRects, type PaneRect } from "./computePaneRects";
import type { LayoutNode, PaneContent } from "./types";

function content(threadId: string): PaneContent {
  return { kind: "thread", projectId: "project-1", threadId };
}

function pane(paneId: string): LayoutNode {
  return { type: "pane", paneId, content: content(paneId) };
}

function expectRect(actual: PaneRect | undefined, expected: PaneRect): void {
  expect(actual).toBeDefined();
  expect(actual?.x).toBeCloseTo(expected.x, 6);
  expect(actual?.y).toBeCloseTo(expected.y, 6);
  expect(actual?.w).toBeCloseTo(expected.w, 6);
  expect(actual?.h).toBeCloseTo(expected.h, 6);
}

describe("computePaneRects", () => {
  it("maps a single pane to the full normalized rect", () => {
    const rects = computePaneRects(pane("pane-1"));
    expect(rects.size).toBe(1);
    expectRect(rects.get("pane-1"), { x: 0, y: 0, w: 1, h: 1 });
  });

  it("splits a row by its sizes into side-by-side rects", () => {
    const root: LayoutNode = {
      type: "split",
      dir: "row",
      sizes: [0.3, 0.7],
      children: [pane("pane-1"), pane("pane-2")],
    };
    const rects = computePaneRects(root);
    expectRect(rects.get("pane-1"), { x: 0, y: 0, w: 0.3, h: 1 });
    expectRect(rects.get("pane-2"), { x: 0.3, y: 0, w: 0.7, h: 1 });
  });

  it("splits a column by its sizes into stacked rects", () => {
    const root: LayoutNode = {
      type: "split",
      dir: "col",
      sizes: [0.25, 0.75],
      children: [pane("pane-1"), pane("pane-2")],
    };
    const rects = computePaneRects(root);
    expectRect(rects.get("pane-1"), { x: 0, y: 0, w: 1, h: 0.25 });
    expectRect(rects.get("pane-2"), { x: 0, y: 0.25, w: 1, h: 0.75 });
  });

  it("nests a column inside a row column to produce a 3-pane arrangement", () => {
    const root: LayoutNode = {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        pane("pane-1"),
        {
          type: "split",
          dir: "col",
          sizes: [0.5, 0.5],
          children: [pane("pane-2"), pane("pane-3")],
        },
      ],
    };
    const rects = computePaneRects(root);
    expectRect(rects.get("pane-1"), { x: 0, y: 0, w: 0.5, h: 1 });
    expectRect(rects.get("pane-2"), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expectRect(rects.get("pane-3"), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("covers the full unit square across a 2x2 layout with no overlaps", () => {
    const root: LayoutNode = {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        {
          type: "split",
          dir: "col",
          sizes: [0.5, 0.5],
          children: [pane("pane-1"), pane("pane-2")],
        },
        {
          type: "split",
          dir: "col",
          sizes: [0.5, 0.5],
          children: [pane("pane-3"), pane("pane-4")],
        },
      ],
    };
    const rects = computePaneRects(root);
    const area = [...rects.values()].reduce((sum, r) => sum + r.w * r.h, 0);
    expect(area).toBeCloseTo(1, 6);
    expectRect(rects.get("pane-4"), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("falls back to equal fractions when sizes are degenerate", () => {
    const root: LayoutNode = {
      type: "split",
      dir: "row",
      sizes: [0, 0],
      children: [pane("pane-1"), pane("pane-2")],
    };
    const rects = computePaneRects(root);
    expectRect(rects.get("pane-1"), { x: 0, y: 0, w: 0.5, h: 1 });
    expectRect(rects.get("pane-2"), { x: 0.5, y: 0, w: 0.5, h: 1 });
  });
});
