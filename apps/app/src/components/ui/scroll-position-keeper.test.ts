// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollPositionKeeper } from "./scroll-position-keeper";

const VIEWPORT_HEIGHT = 500;

interface LaidOutRow {
  id: string;
  height: number;
  children?: LaidOutRow[];
}

function createTimeline(initialRows: LaidOutRow[]) {
  const scrollElement = document.createElement("div");
  const list = document.createElement("div");
  scrollElement.append(list);
  document.body.append(scrollElement);
  let scrollTop = 0;
  let rows = initialRows;
  const offsets = new Map<string, { top: number; height: number }>();

  Object.defineProperty(scrollElement, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, value);
    },
  });
  Object.defineProperty(scrollElement, "clientHeight", {
    configurable: true,
    value: VIEWPORT_HEIGHT,
  });
  vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 100, VIEWPORT_HEIGHT),
  );

  const elements = new Map<string, HTMLElement>();
  const elementFor = (id: string) => {
    const existing = elements.get(id);
    if (existing !== undefined) return existing;
    const element = document.createElement("div");
    elements.set(id, element);
    element.setAttribute("data-timeline-row-id", id);
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
      const offset = offsets.get(id);
      return offset === undefined
        ? new DOMRect(0, 0, 0, 0)
        : new DOMRect(0, offset.top - scrollTop, 100, offset.height);
    });
    return element;
  };

  const layout = () => {
    offsets.clear();
    list.replaceChildren();
    let top = 0;
    const place = (row: LaidOutRow, parent: HTMLElement) => {
      const element = elementFor(row.id);
      element.replaceChildren();
      parent.append(element);
      offsets.set(row.id, { top, height: row.height });
      let childTop = top;
      for (const child of row.children ?? []) {
        const childElement = elementFor(child.id);
        element.append(childElement);
        offsets.set(child.id, { top: childTop, height: child.height });
        childTop += child.height;
      }
      top += row.height;
    };
    for (const row of rows) place(row, list);
  };
  layout();

  const keeperOptions = { active: true };
  const keeper = new ScrollPositionKeeper({
    getScrollElement: () => scrollElement,
    getTopLevelRows: () =>
      Array.from(list.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      ),
    isActive: () => keeperOptions.active,
  });

  return {
    keeper,
    keeperOptions,
    scrollElement,
    get scrollTop() {
      return scrollTop;
    },
    scrollTo(value: number) {
      scrollTop = value;
    },
    setRows(next: LaidOutRow[]) {
      rows = next;
      layout();
    },
    viewportTopOf(id: string) {
      const offset = offsets.get(id);
      if (offset === undefined) throw new Error(`No row ${id}`);
      return offset.top - scrollTop;
    },
  };
}

function rowsOf(count: number, height = 200, prefix = "row"): LaidOutRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    height,
  }));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ScrollPositionKeeper", () => {
  it("keeps the reading row still when older rows are prepended", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.scrollTo(900);
    timeline.keeper.handleScroll();
    const before = timeline.viewportTopOf("row-5");

    timeline.setRows([...rowsOf(4, 300, "older"), ...rowsOf(10)]);
    timeline.keeper.reconcile();

    expect(timeline.scrollTop).toBe(2_100);
    expect(timeline.viewportTopOf("row-5")).toBe(before);
  });

  it("keeps the position momentum scrolling reached before the rows arrive", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.scrollTo(900);
    timeline.keeper.handleScroll();

    timeline.scrollTo(400);
    timeline.keeper.handleScroll();
    timeline.scrollTo(150);
    timeline.keeper.handleScroll();
    const before = timeline.viewportTopOf("row-1");

    timeline.setRows([...rowsOf(2, 500, "older"), ...rowsOf(10)]);
    timeline.keeper.reconcile();

    expect(timeline.scrollTop).toBe(1_150);
    expect(timeline.viewportTopOf("row-1")).toBe(before);
  });

  it("composes with scrolling that happens between layout changes", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.scrollTo(900);
    timeline.keeper.handleScroll();

    timeline.scrollTo(700);
    timeline.keeper.reconcile();

    expect(timeline.scrollTop).toBe(700);
  });

  it("corrects a foreign write that ignored a layout change above the reader", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.scrollTo(900);
    timeline.keeper.handleScroll();
    const before = timeline.viewportTopOf("row-5");

    timeline.setRows([{ id: "older", height: 3_000 }, ...rowsOf(10)]);
    timeline.scrollTo(865);
    timeline.keeper.handleScroll();

    expect(timeline.viewportTopOf("row-5")).toBe(before + 35);
  });

  it("locates an unmounted anchor through a registered row offset source", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.scrollTo(900);
    timeline.keeper.handleScroll();
    timeline.keeper.registerRowOffsetSource((rowId) =>
      rowId === "row-5" ? 3_400 : null,
    );

    timeline.setRows(rowsOf(3, 1_000, "older"));
    timeline.keeper.reconcile();

    expect(timeline.scrollTop).toBe(3_300);
  });

  it("notifies write subscribers after it moves the scroll position", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.scrollTo(900);
    timeline.keeper.handleScroll();
    const listener = vi.fn(() => timeline.scrollTop);
    timeline.keeper.subscribeScrollWrites(listener);

    timeline.setRows([{ id: "older", height: 120 }, ...rowsOf(10)]);
    timeline.keeper.reconcile();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveReturnedWith(1_020);
  });

  it("anchors to a nested row that starts inside the viewport", () => {
    const timeline = createTimeline([
      {
        id: "turn",
        height: 1_500,
        children: rowsOf(5, 300, "step"),
      },
      ...rowsOf(5),
    ]);
    timeline.scrollTo(250);
    timeline.keeper.handleScroll();
    const before = timeline.viewportTopOf("step-1");

    timeline.setRows([
      {
        id: "turn",
        height: 1_700,
        children: [{ id: "step-0", height: 500 }, ...rowsOf(4, 300, "step").slice(1)],
      },
      ...rowsOf(5),
    ]);
    timeline.keeper.reconcile();

    expect(timeline.viewportTopOf("step-1")).toBe(before);
  });

  it("leaves scrolling and native anchoring to others while inactive", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.scrollTo(900);
    timeline.keeper.handleScroll();
    expect(timeline.scrollElement.style.overflowAnchor).toBe("none");

    timeline.keeperOptions.active = false;
    timeline.keeper.capture();
    timeline.setRows([{ id: "older", height: 400 }, ...rowsOf(10)]);
    timeline.keeper.reconcile();

    expect(timeline.scrollTop).toBe(900);
    expect(timeline.scrollElement.style.overflowAnchor).toBe("");
  });

  it("holds an element edge instead of the top row while a hold lasts", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.scrollTo(900);
    timeline.keeper.handleScroll();
    const element = timeline.scrollElement.querySelector<HTMLElement>(
      '[data-timeline-row-id="row-6"]',
    );
    if (element === null) throw new Error("Expected row-6");
    timeline.keeper.hold(element, "bottom", 250);
    const bottomBefore = timeline.viewportTopOf("row-6") + 200;

    timeline.setRows([
      ...rowsOf(6),
      { id: "row-6", height: 50 },
      ...rowsOf(10).slice(7),
    ]);
    timeline.keeper.reconcile();

    expect(timeline.viewportTopOf("row-6") + 50).toBe(bottomBefore);
  });
});
