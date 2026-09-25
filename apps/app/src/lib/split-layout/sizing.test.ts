import { describe, expect, it } from "vitest";
import { fitSplitWidths, minimumSplitWidth, splitWidthLimits } from "./sizing";
import { resizeSplit } from "./ops";
import { deserializeSplitLayout, serializeSplitLayout } from "./persistence";
import type { LayoutNode, SplitNode } from "./types";

const pane = (paneId: string): LayoutNode => ({
  type: "pane",
  paneId,
  content: { kind: "new-thread" },
});
const row = (sizes = [0.5, 0.5]): SplitNode => ({
  type: "split",
  dir: "row",
  sizes,
  children: [pane("a"), pane("b")],
});

describe("pixel pane minimums", () => {
  it.each([480, 960, 2400, 4800])(
    "keeps both minimums at 240px across a %ipx pair",
    (width) => {
      const limits = splitWidthLimits(width);
      expect(limits.min * width).toBeCloseTo(240);
      expect((1 - limits.max) * width).toBeCloseTo(240);
    },
  );

  it("relaxes impossible minimums proportionally without inverted bounds", () => {
    expect(splitWidthLimits(300)).toEqual({ min: 0.5, max: 0.5 });
    const limits = splitWidthLimits(300, 480, 240);
    expect(limits.min).toBeCloseTo(2 / 3);
    expect(limits.max).toBeCloseTo(2 / 3);
  });

  it("fits restored widths to a smaller viewport without changing saved proportions", () => {
    const saved = row([0.1, 0.9]);
    const fitted = fitSplitWidths(saved, 801);
    expect(fitted).toMatchObject({
      sizes: [expect.closeTo(0.3), expect.closeTo(0.7)],
    });
    expect(saved.sizes).toEqual([0.1, 0.9]);
    expect(fitSplitWidths(saved, 2401)).toBe(saved);
    expect(fitSplitWidths(fitted, 801)).toBe(fitted);
  });

  it("reserves widths for nested rows and shares width across stacked panes", () => {
    const nested: SplitNode = {
      ...row([0.3, 0.7]),
      children: [row(), pane("c")],
    };
    expect(minimumSplitWidth(nested)).toBe(722);
    const stacked: SplitNode = { ...nested, dir: "col" };
    expect(minimumSplitWidth(stacked)).toBe(481);
    const fitted = fitSplitWidths(nested, 1001);
    expect(fitted).toMatchObject({
      sizes: [expect.closeTo(0.481), expect.closeTo(0.519)],
    });
    const small = fitSplitWidths(nested, 501);
    if (small.type !== "split") throw new Error("Expected split");
    expect(small.sizes[0]).toBeCloseTo(481 / 721);
    expect(small.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
  });

  it("preserves a sub-15% horizontal resize through subsequent edits and persistence", () => {
    const initial = { root: row(), focusedPaneId: "a" };
    const narrow = resizeSplit(initial, [], 0, 0.1);
    expect(narrow.root).toMatchObject({ sizes: [0.1, 0.9] });
    const restored = deserializeSplitLayout(serializeSplitLayout(narrow));
    expect(restored).toEqual(narrow);
    const again = resizeSplit(narrow, [], 0, 0.12);
    expect(again.root).toMatchObject({ sizes: [0.12, 0.88] });
  });
  it("normalizes stored weights before fitting nested widths", () => {
    expect(fitSplitWidths(row([1, 1]), 1001)).toMatchObject({
      sizes: [0.5, 0.5],
    });
  });

  it("keeps vertical resize limits", () => {
    const initial = {
      root: { ...row(), dir: "col" as const },
      focusedPaneId: "a",
    };
    expect(resizeSplit(initial, [], 0, 0.01).root).toMatchObject({
      sizes: [0.15, 0.85],
    });
  });
});
