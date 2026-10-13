import { describe, expect, it } from "vitest";
import { ROW_WINDOW_THRESHOLD, rowWindows } from "./row-window.js";

const base = { headerHeight: 40, rowHeight: 36, viewportHeight: 700 };

describe("rowWindows", () => {
  it("renders small groups in full", () => {
    expect(rowWindows({ ...base, counts: [3, 10], scrollTop: 0 })).toEqual([
      [0, 3],
      [0, 10],
    ]);
  });

  it("windows a large group around the viewport", () => {
    const [range] = rowWindows({ ...base, counts: [5000], scrollTop: 36_000 });
    const [start, end] = range!;
    const firstVisible = Math.floor((36_000 - base.headerHeight) / 36);
    const lastVisible = Math.ceil((36_700 - base.headerHeight) / 36);
    expect(start).toBeLessThanOrEqual(firstVisible);
    expect(end).toBeGreaterThanOrEqual(lastVisible);
    expect(end - start).toBeLessThan(200);
  });

  it("offsets later groups by the rows above them", () => {
    const above = ROW_WINDOW_THRESHOLD - 20;
    const [first, second] = rowWindows({
      ...base,
      counts: [above, 5000],
      scrollTop: 0,
    });
    expect(first).toEqual([0, above]);
    expect(second).toEqual([0, 0]);
  });

  it("falls back to a bounded slice before the viewport is measured", () => {
    const [range] = rowWindows({
      counts: [5000],
      headerHeight: 0,
      rowHeight: 0,
      scrollTop: 0,
      viewportHeight: 0,
    });
    expect(range![0]).toBe(0);
    expect(range![1]).toBeLessThan(5000);
  });
});
