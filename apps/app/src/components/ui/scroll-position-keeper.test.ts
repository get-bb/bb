// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeFlowLayout, setFakeHeight } from "@/test/fake-flow-layout";
import { WINDOW_FIND_OPEN_EVENT } from "@/lib/window-find";
import { ScrollPositionKeeper } from "./scroll-position-keeper";

const VIEWPORT_HEIGHT = 500;

interface RowSpec {
  id: string;
  height: number;
  children?: RowSpec[];
}

let restoreLayout: (() => void) | null = null;

afterEach(() => {
  restoreLayout?.();
  restoreLayout = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function rowsOf(count: number, height = 200, prefix = "row"): RowSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    height,
  }));
}

function createTimeline(
  initialRows: RowSpec[],
  {
    deferWrites = false,
    attached = false,
    footerTop = null,
    floor = true,
  }: {
    deferWrites?: boolean;
    attached?: boolean;
    footerTop?: number | null;
    floor?: boolean;
  } = {},
) {
  const scrollElement = document.createElement("div");
  const content = document.createElement("div");
  const list = document.createElement("div");
  list.setAttribute("data-timeline-row-list", "top-level");
  const items = document.createElement("div");
  items.setAttribute("data-timeline-items", "");
  list.append(items);
  content.append(list);
  const floorElement = floor ? document.createElement("div") : null;
  if (floorElement === null) {
    scrollElement.append(content);
  } else {
    const scrollContent = document.createElement("div");
    scrollContent.append(floorElement, content);
    scrollElement.append(scrollContent);
  }
  document.body.append(scrollElement);
  const layout = installFakeFlowLayout({
    scrollElement,
    viewportHeight: VIEWPORT_HEIGHT,
  });
  restoreLayout = layout.restore;

  const elements = new Map<string, HTMLElement>();
  const build = (row: RowSpec): HTMLElement => {
    const element = elements.get(row.id) ?? document.createElement("div");
    elements.set(row.id, element);
    element.setAttribute("data-timeline-row-id", row.id);
    element.replaceChildren(...(row.children ?? []).map(build));
    if (row.children === undefined) setFakeHeight(element, row.height);
    else element.removeAttribute("data-fake-height");
    return element;
  };
  const setRows = (rows: RowSpec[]) => {
    items.replaceChildren(...rows.map(build));
  };
  setRows(initialRows);
  const footer = document.createElement("div");
  footer.getBoundingClientRect = () =>
    new DOMRect(0, footerTop ?? VIEWPORT_HEIGHT, 100, 80);

  const keeper = new ScrollPositionKeeper({
    bottomThresholdPx: 4,
    deferWritesWhileScrolling: deferWrites,
    getContentElement: () => content,
    getFloorElement: () => floorElement,
    getFooterElement: () => (footerTop === null ? null : footer),
    getScrollElement: () => scrollElement,
    getTopLevelRows: () =>
      items.querySelectorAll<HTMLElement>(":scope > [data-timeline-row-id]"),
    initiallyAttached: attached,
  });
  const disconnect = keeper.connect(scrollElement);
  const previousRestore = restoreLayout;
  restoreLayout = () => {
    disconnect();
    previousRestore?.();
  };

  const element = (id: string) => {
    const found = elements.get(id);
    if (found === undefined) throw new Error(`No row ${id}`);
    return found;
  };

  return {
    content,
    element,
    keeper,
    layout,
    scrollElement,
    setRows,
    topOf: (id: string) => element(id).getBoundingClientRect().top,
    resize(id: string, height: number) {
      setFakeHeight(element(id), height);
    },
    userScrollTo(top: number) {
      layout.userScrollTo(top);
    },
  };
}

describe("ScrollPositionKeeper", () => {
  it("keeps the reading row in place when an older page is prepended", () => {
    const rows = rowsOf(10);
    const timeline = createTimeline(rows);
    timeline.userScrollTo(450);
    const before = timeline.topOf("row-3");

    timeline.setRows([...rowsOf(6, 150, "older"), ...rows]);
    timeline.keeper.reconcile();

    expect(timeline.topOf("row-3")).toBe(before);
    expect(timeline.keeper.isAttached()).toBe(false);
  });

  it("keeps native scroll anchoring off on the root while attached, detached, and back at the end", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });
    expect(timeline.scrollElement.style.overflowAnchor).toBe("none");
    timeline.userScrollTo(timeline.layout.maxScrollTop() - 800);
    expect(timeline.keeper.isAttached()).toBe(false);
    expect(timeline.scrollElement.style.overflowAnchor).toBe("none");
    timeline.keeper.scrollToBottom();
    expect(timeline.keeper.isAttached()).toBe(true);
    expect(timeline.scrollElement.style.overflowAnchor).toBe("none");
  });

  it("drives each reconcile to the same intent, so a clamped intermediate correction is not counted twice", () => {
    const rows = rowsOf(10);
    const timeline = createTimeline(rows);
    timeline.userScrollTo(450);
    const before = timeline.topOf("row-3");

    timeline.setRows(rows.slice(3));
    timeline.keeper.reconcile();
    expect(timeline.layout.scrollTop).toBe(0);

    timeline.setRows([...rowsOf(8, 100, "older"), ...rows]);
    timeline.keeper.reconcile();
    timeline.keeper.reconcile();

    expect(timeline.topOf("row-3")).toBe(before);
  });

  it("attaches when content shrinks under a detached reader and the clamp to the end persists", () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    const rows = rowsOf(10);
    const timeline = createTimeline(rows);
    timeline.userScrollTo(1200);

    timeline.setRows(rows.slice(0, 7));
    timeline.layout.flushResizeObservers();
    timeline.scrollElement.dispatchEvent(new Event("scroll"));
    expect(timeline.keeper.isAttached()).toBe(false);
    vi.advanceTimersToNextFrame();

    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("attaches a detached reader whose finger is down when content shrinks and clamps them onto the end", () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    const rows = rowsOf(10);
    const timeline = createTimeline(rows, { attached: true });
    timeline.userScrollTo(1_300);
    vi.advanceTimersByTime(500);
    expect(timeline.keeper.isAttached()).toBe(false);

    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));
    timeline.setRows(rows.slice(0, 8));
    timeline.layout.flushResizeObservers();
    if (timeline.layout.takeClamp()) {
      timeline.scrollElement.dispatchEvent(new Event("scroll"));
    }
    vi.advanceTimersToNextFrame();

    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);

    timeline.scrollElement.dispatchEvent(new TouchEvent("touchend"));
    timeline.setRows([...rows.slice(0, 8), { id: "row-new", height: 250 }]);
    timeline.layout.flushResizeObservers();
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("attaches when a row collapses onto the end right after a touch drag, while fling momentum still counts as the reader's", () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    const rows = rowsOf(10);
    const timeline = createTimeline(rows, { attached: true });
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));
    timeline.layout.layoutScrollTo(timeline.layout.scrollTop - 55);
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchend"));
    vi.advanceTimersByTime(500);
    expect(timeline.keeper.isAttached()).toBe(false);

    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchend"));
    timeline.resize("row-9", 40);
    timeline.layout.layoutScrollTo(timeline.layout.maxScrollTop());
    timeline.keeper.reconcile();
    vi.advanceTimersToNextFrame();

    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("leaves a view the reader never placed at the top while its content loads in, instead of following it", () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    const timeline = createTimeline(rowsOf(1, 100));
    vi.advanceTimersToNextFrame();

    timeline.setRows(rowsOf(10));
    timeline.keeper.reconcile();
    vi.advanceTimersToNextFrame();

    expect(timeline.layout.scrollTop).toBe(0);
    expect(timeline.keeper.isAttached()).toBe(false);
  });

  it.each([false, true])(
    "stays attached when content shrinks and regrows within a frame and the clamp scroll arrives late (deferWrites=%s)",
    (deferWrites) => {
      vi.useFakeTimers({
        toFake: [
          "setTimeout",
          "clearTimeout",
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "performance",
        ],
      });
      const rows = [...rowsOf(9), { id: "last", height: 1200 }];
      const timeline = createTimeline(rows, { attached: true, deferWrites });
      timeline.layout.flushResizeObservers();
      vi.advanceTimersByTime(5_000);
      expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());

      timeline.resize("last", 975);
      void timeline.scrollElement.scrollHeight;
      timeline.resize("last", 1200);
      timeline.layout.flushResizeObservers();
      const clamped = timeline.layout.takeClamp();
      if (clamped) timeline.scrollElement.dispatchEvent(new Event("scroll"));
      vi.advanceTimersToNextFrame();
      vi.advanceTimersByTime(5_000);

      expect(clamped).toBe(false);
      expect(timeline.keeper.isAttached()).toBe(true);
      expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    },
  );

  it("stays attached when a shrink clamps the scroll during a touch before the resize is observed, and follows the regrowth", () => {
    const rows = [...rowsOf(9), { id: "last", height: 1_200 }];
    const timeline = createTimeline(rows, { attached: true, floor: false });
    timeline.layout.flushResizeObservers();
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());

    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));
    timeline.resize("last", 400);
    expect(timeline.layout.takeClamp()).toBe(true);
    timeline.scrollElement.dispatchEvent(new Event("scroll"));

    expect(timeline.keeper.isAttached()).toBe(true);
    expect(timeline.keeper.savedPosition()).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });

    timeline.layout.flushResizeObservers();
    timeline.resize("last", 650);
    timeline.layout.flushResizeObservers();
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchend"));
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("keeps an attached view at the end when it scrolls without input or a size change", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });

    timeline.layout.layoutScrollTo(timeline.layout.scrollTop - 300);

    expect(timeline.keeper.isAttached()).toBe(true);
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.hasUserScrolled()).toBe(false);
  });

  it("keeps a pending restore when the view scrolls without input before the row mounts", () => {
    const rows = rowsOf(10);
    const timeline = createTimeline(rows.slice(5), { attached: true });

    timeline.keeper.restore({
      rowId: "row-2",
      offsetWithinRow: 0,
      atBottom: false,
    });
    timeline.layout.layoutScrollTo(timeline.layout.scrollTop - 200);
    timeline.setRows(rows);
    timeline.layout.flushResizeObservers();

    expect(timeline.topOf("row-2")).toBe(0);
    expect(timeline.keeper.hasUserScrolled()).toBe(false);
  });

  it("keeps a wheel scroll whose scroll event has not arrived when a layout reconcile runs first", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(900);

    timeline.scrollElement.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -200 }),
    );
    timeline.layout.bounceTo(700);
    timeline.keeper.reconcile();
    expect(timeline.layout.scrollTop).toBe(700);

    timeline.scrollElement.dispatchEvent(new Event("scroll"));
    expect(timeline.layout.scrollTop).toBe(700);
  });

  it("follows a detached view's scroll without input, such as find in page, when a layout reconcile runs before its scroll event", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance"],
    });
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(900);
    vi.advanceTimersByTime(500);

    timeline.layout.bounceTo(700);
    timeline.keeper.reconcile();
    timeline.scrollElement.dispatchEvent(new Event("scroll"));

    expect(timeline.layout.scrollTop).toBe(700);
  });

  it("follows a scroll without input while the window find bar is open, and keeps the end again once the window has focus", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });

    window.dispatchEvent(new Event(WINDOW_FIND_OPEN_EVENT));
    timeline.layout.layoutScrollTo(400);
    expect(timeline.keeper.isAttached()).toBe(false);
    expect(timeline.layout.scrollTop).toBe(400);

    timeline.keeper.scrollToBottom();
    window.dispatchEvent(new Event("focus"));
    timeline.layout.layoutScrollTo(400);
    expect(timeline.keeper.isAttached()).toBe(true);
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
  });

  it("follows a focus move after Tab as the reader's scroll", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    timeline.layout.layoutScrollTo(400);

    expect(timeline.keeper.isAttached()).toBe(false);
    expect(timeline.layout.scrollTop).toBe(400);
  });

  it("ignores scroll keys typed into an editable control, so a scroll that follows still counts as layout", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });
    const textarea = document.createElement("textarea");
    const button = document.createElement("button");
    timeline.content.append(textarea, button);

    for (const key of ["End", "ArrowUp", "PageUp", " "]) {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    }
    timeline.layout.layoutScrollTo(400);

    expect(timeline.keeper.isAttached()).toBe(true);
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.hasUserScrolled()).toBe(false);

    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    timeline.layout.layoutScrollTo(400);

    expect(timeline.keeper.isAttached()).toBe(false);
    expect(timeline.layout.scrollTop).toBe(400);
  });

  it("follows content that stays shrunk to the new end", () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    const rows = [...rowsOf(9), { id: "last", height: 1200 }];
    const timeline = createTimeline(rows, { attached: true });
    timeline.layout.flushResizeObservers();
    const before = timeline.layout.maxScrollTop();

    timeline.resize("last", 975);
    timeline.layout.flushResizeObservers();
    vi.advanceTimersToNextFrame();

    expect(timeline.layout.maxScrollTop()).toBe(before - 225);
    expect(timeline.layout.scrollTop).toBe(before - 225);
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("keeps a detached reader on their row when content shrinks onto the end for a single frame", () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    const rows = rowsOf(10);
    const timeline = createTimeline(rows);
    timeline.userScrollTo(1200);
    const before = timeline.topOf("row-7");

    timeline.setRows(rows.slice(0, 7));
    timeline.keeper.reconcile();
    timeline.setRows(rows);
    vi.advanceTimersToNextFrame();

    expect(timeline.topOf("row-7")).toBe(before);
    expect(timeline.keeper.isAttached()).toBe(false);
  });

  it("attaches when the viewport grows and the reader's position no longer fits above the end", () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(1350);
    vi.advanceTimersByTime(500);
    expect(timeline.keeper.isAttached()).toBe(false);

    timeline.layout.setViewportHeight(800);
    timeline.layout.layoutScrollTo(timeline.layout.maxScrollTop());
    timeline.keeper.reconcile();
    vi.advanceTimersToNextFrame();
    expect(timeline.keeper.isAttached()).toBe(true);

    timeline.setRows(rowsOf(11));
    timeline.keeper.reconcile();
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
  });

  it("keeps a detached reader on their row when the viewport grows but the row still fits above the end", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(400);
    vi.advanceTimersByTime(500);
    const before = timeline.topOf("row-3");

    timeline.layout.setViewportHeight(800);
    timeline.keeper.reconcile();

    expect(timeline.keeper.isAttached()).toBe(false);
    expect(timeline.topOf("row-3")).toBe(before);
  });

  it("keeps an attached view at the end within the resize callback when the viewport gets shorter", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });
    timeline.layout.flushResizeObservers();
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());

    timeline.layout.setViewportHeight(300);
    expect(timeline.layout.scrollTop).toBeLessThan(
      timeline.layout.maxScrollTop(),
    );
    timeline.layout.flushResizeObservers();

    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("saves a detached reader who sits at the end as at the bottom", () => {
    const rows = rowsOf(10);
    const timeline = createTimeline(rows);
    timeline.userScrollTo(1200);
    timeline.setRows(rows.slice(0, 7));
    timeline.layout.flushResizeObservers();
    expect(timeline.keeper.isAttached()).toBe(false);

    expect(timeline.keeper.savedPosition()).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
  });

  it("attaches when a restored row lands at the end", () => {
    const timeline = createTimeline(rowsOf(10));

    timeline.keeper.restore({
      rowId: "row-8",
      offsetWithinRow: 0,
      atBottom: false,
    });

    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("lands on a landmark between rows and holds it at the top while rows above it change height", () => {
    const rows = rowsOf(10);
    const timeline = createTimeline(rows, { attached: true });
    const landmark = document.createElement("div");
    landmark.setAttribute("data-scroll-landmark-id", "divider");
    setFakeHeight(landmark, 24);
    const items = timeline.scrollElement.querySelector("[data-timeline-items]");
    const rowFour = items?.children[4] ?? null;
    items?.insertBefore(landmark, rowFour);

    timeline.keeper.restore({
      rowId: "divider",
      offsetWithinRow: 0,
      atBottom: false,
    });
    const viewportTop = timeline.scrollElement.getBoundingClientRect().top;
    expect(landmark.getBoundingClientRect().top).toBe(viewportTop);
    expect(timeline.keeper.isAttached()).toBe(false);

    timeline.resize("row-1", 520);
    timeline.keeper.reconcile();
    expect(landmark.getBoundingClientRect().top).toBe(viewportTop);
  });

  it("keeps the end in view on every layout change while attached and stays attached", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());

    timeline.resize("row-9", 900);
    timeline.keeper.reconcile();
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());

    timeline.resize("row-4", 20);
    timeline.keeper.reconcile();
    timeline.scrollElement.dispatchEvent(new Event("scroll"));
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("stays attached when a navigation target clamps to the end, so content that grows afterwards stays in view", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });

    timeline.keeper.scrollTo(timeline.topOf("row-8") + 1600, "instant");
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);

    timeline.resize("row-9", 260);
    timeline.keeper.reconcile();
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
  });

  it("detaches when a navigation target lands above the end", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });

    timeline.keeper.scrollTo(400, "instant");
    expect(timeline.keeper.isAttached()).toBe(false);

    timeline.resize("row-9", 260);
    timeline.keeper.reconcile();
    expect(timeline.layout.scrollTop).toBe(400);
  });

  it("stays attached when revealing a row that is already visible at the end", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });
    const row = timeline.element("row-9");
    row.scrollIntoView = () => undefined;

    timeline.keeper.revealElement(row, { block: "nearest" });
    expect(timeline.keeper.isAttached()).toBe(true);

    timeline.setRows(rowsOf(11));
    timeline.keeper.reconcile();
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("keeps a revealed row at the top when a row above it resizes before the reveal's scroll event, and tells windowed lists at once", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });
    const onPositionChange = vi.fn();
    timeline.keeper.registerList({ itemAt: () => null, onPositionChange });
    const target = timeline.element("row-2");
    target.scrollIntoView = () => {
      timeline.scrollElement.scrollTop = 400;
    };

    timeline.keeper.revealElement(target, { block: "start" });
    expect(onPositionChange).toHaveBeenCalled();
    expect(timeline.topOf("row-2")).toBe(0);
    expect(timeline.keeper.isAttached()).toBe(false);

    timeline.resize("row-1", 260);
    timeline.layout.flushResizeObservers();
    timeline.scrollElement.dispatchEvent(new Event("scroll"));

    expect(timeline.topOf("row-2")).toBe(0);
    expect(timeline.keeper.isAttached()).toBe(false);
  });

  it("shifts content above an attached toggle by exactly the height change", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });
    const lastBottom = () => timeline.topOf("row-9") + 200;
    const bottomBefore = lastBottom();
    const toggledBefore = timeline.topOf("row-8");

    timeline.resize("row-8", 450);
    timeline.keeper.reconcile();

    expect(lastBottom()).toBe(bottomBefore);
    expect(timeline.topOf("row-8")).toBe(toggledBefore - 250);
  });

  it("keeps the reader in place through another visible row when the anchor row's key goes away", () => {
    const rows = rowsOf(10);
    const timeline = createTimeline(rows);
    timeline.userScrollTo(450);
    const before = timeline.topOf("row-4");

    timeline.setRows([
      ...rows.slice(0, 1),
      { id: "row-1-and-2", height: 120 },
      { id: "row-3-renamed", height: 200 },
      ...rows.slice(4),
    ]);
    timeline.keeper.reconcile();

    expect(timeline.topOf("row-4")).toBe(before);
  });

  it("does not write when nothing changed above the reading row", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(450);
    const setter = vi.spyOn(timeline.scrollElement, "scrollTop", "set");

    timeline.resize("row-8", 600);
    timeline.keeper.reconcile();
    timeline.keeper.reconcile();

    expect(setter).not.toHaveBeenCalled();
  });

  it("corrects a row above the reading row resizing within the same reconcile", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(450);
    const before = timeline.topOf("row-3");

    timeline.resize("row-1", 520);
    timeline.keeper.reconcile();

    expect(timeline.topOf("row-3")).toBe(before);
  });

  it("attaches only when the reader scrolls down into the end, and detaches when they scroll up out of it", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });
    const max = timeline.layout.maxScrollTop();

    timeline.userScrollTo(max - 2);
    expect(timeline.keeper.isAttached()).toBe(true);
    timeline.userScrollTo(max - 300);
    expect(timeline.keeper.isAttached()).toBe(false);
    timeline.userScrollTo(max - 200);
    expect(timeline.keeper.isAttached()).toBe(false);
    timeline.userScrollTo(max - 6);
    expect(timeline.keeper.isAttached()).toBe(false);
    timeline.userScrollTo(max - 3);
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("attributes layout that changed before a scroll event to layout, not to the reader's movement", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(450);
    const before = timeline.topOf("row-3");

    timeline.resize("row-1", 224);
    timeline.userScrollTo(440);

    expect(timeline.topOf("row-3")).toBe(before + 10);
  });

  it("corrects a row above the reading row that grows while the lists re-render for a scroll", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(450);
    let grown = false;
    timeline.keeper.registerList({
      itemAt: () => null,
      onPositionChange: () => {
        if (grown) return;
        grown = true;
        timeline.resize("row-1", 220);
      },
    });
    const before = timeline.topOf("row-3");

    timeline.userScrollTo(440);

    expect(timeline.topOf("row-3")).toBe(before + 10);
  });

  it("adopts the rows that mount under an estimated position instead of moving the view to the estimate", () => {
    const timeline = createTimeline([]);
    const spacer = document.createElement("div");
    setFakeHeight(spacer, 6_000);
    timeline.content.prepend(spacer);
    timeline.keeper.reconcile();
    timeline.keeper.registerList({
      itemAt: (viewportTop) => ({ key: "row-1", top: viewportTop + 40 }),
      onPositionChange: () => {
        if (timeline.content.firstElementChild !== spacer) return;
        spacer.remove();
        timeline.setRows(rowsOf(20));
      },
    });

    timeline.userScrollTo(1_100);

    expect(timeline.layout.scrollTop).toBe(1_100);
    expect(timeline.topOf("row-5")).toBe(-100);
    timeline.keeper.reconcile();
    expect(timeline.layout.scrollTop).toBe(1_100);
  });

  it("measures a logarithmic number of rows per scroll event, however long the timeline is", () => {
    const measuredPerScroll = (count: number) => {
      const timeline = createTimeline(rowsOf(count, 120));
      timeline.userScrollTo(count * 60);
      const reads = vi.spyOn(Element.prototype, "getBoundingClientRect");
      timeline.userScrollTo(count * 60 - 300);
      const calls = reads.mock.calls.length;
      reads.mockRestore();
      restoreLayout?.();
      restoreLayout = null;
      document.body.replaceChildren();
      return calls;
    };

    const short = measuredPerScroll(100);
    const long = measuredPerScroll(1_000);

    expect(long - short).toBeLessThanOrEqual(15);
  });

  it("anchors the first top-level row that starts in the viewport, not a nested row above it", () => {
    const timeline = createTimeline([
      ...rowsOf(2),
      {
        id: "group",
        height: 0,
        children: [
          { id: "group-a", height: 300 },
          { id: "group-b", height: 300 },
        ],
      },
      ...rowsOf(5, 200, "after"),
    ]);
    timeline.userScrollTo(850);
    const before = timeline.topOf("after-0");

    timeline.resize("group-b", 340);
    timeline.keeper.reconcile();

    expect(timeline.topOf("after-0")).toBe(before);
  });

  it("anchors a nested row that is the first to start in a viewport its parent row covers", () => {
    const timeline = createTimeline([
      { id: "turn", height: 0, children: rowsOf(5, 300, "step") },
      ...rowsOf(5),
    ]);
    timeline.userScrollTo(250);
    const before = timeline.topOf("step-1");

    timeline.setRows([
      {
        id: "turn",
        height: 0,
        children: [
          { id: "step-0", height: 500 },
          ...rowsOf(5, 300, "step").slice(1),
        ],
      },
      ...rowsOf(5),
    ]);
    timeline.keeper.reconcile();

    expect(before).toBe(50);
    expect(timeline.topOf("step-1")).toBe(before);
    expect(timeline.layout.scrollTop).toBe(450);
  });

  it("anchors the row the reader can see, not one hidden behind the composer", () => {
    const timeline = createTimeline(rowsOf(10, 450), { footerTop: 300 });
    timeline.userScrollTo(1_000);
    const before = timeline.topOf("row-2");

    timeline.resize("row-2", 500);
    timeline.keeper.reconcile();

    expect(timeline.topOf("row-2")).toBe(before);
  });

  it("holds a correction as a transform during a touch and writes it once scrolling settles", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const rows = rowsOf(10);
    const timeline = createTimeline(rows, { deferWrites: true });
    timeline.userScrollTo(450);
    vi.advanceTimersByTime(500);
    const before = timeline.topOf("row-3");
    const setter = vi.spyOn(timeline.scrollElement, "scrollTop", "set");

    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));
    timeline.setRows([...rowsOf(4, 100, "older"), ...rows]);
    timeline.keeper.reconcile();
    expect(setter).not.toHaveBeenCalled();
    expect(timeline.topOf("row-3")).toBe(before);

    timeline.scrollElement.dispatchEvent(new TouchEvent("touchend"));
    vi.advanceTimersByTime(400);
    expect(setter).toHaveBeenCalled();
    expect(timeline.content.style.transform).toBe("");
    expect(timeline.topOf("row-3")).toBe(before);
  });

  it("writes a held correction once the finger lifts from a target that left the document, so older rows loaded mid-touch stay reachable", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const rows = rowsOf(10);
    const timeline = createTimeline(rows, { deferWrites: true });
    const loadingStatus = document.createElement("div");
    timeline.content.prepend(loadingStatus);
    timeline.userScrollTo(450);
    vi.advanceTimersByTime(500);
    const before = timeline.topOf("row-3");

    loadingStatus.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
    loadingStatus.remove();
    timeline.setRows([...rowsOf(4, 100, "older"), ...rows]);
    timeline.keeper.reconcile();
    expect(timeline.content.style.transform).not.toBe("");

    loadingStatus.dispatchEvent(new TouchEvent("touchend", { bubbles: true }));
    vi.advanceTimersByTime(400);

    expect(timeline.content.style.transform).toBe("");
    expect(timeline.layout.scrollTop).toBe(850);
    expect(timeline.topOf("row-3")).toBe(before);
  });

  it("keeps a touch drag that delivered no scroll events as the reader's movement", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const timeline = createTimeline(rowsOf(10), { deferWrites: true });
    timeline.userScrollTo(600);
    vi.advanceTimersByTime(500);

    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));
    timeline.layout.bounceTo(400);
    const after = timeline.topOf("row-3");
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchend"));
    vi.advanceTimersByTime(400);
    timeline.keeper.reconcile();

    expect(timeline.layout.scrollTop).toBe(400);
    expect(timeline.topOf("row-3")).toBe(after);
  });

  it("keeps fling momentum as the reader's movement after a long frame, while correcting layout that changed with it", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(600);
    vi.advanceTimersByTime(500);
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));
    timeline.layout.layoutScrollTo(560);
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchend"));
    const before = timeline.topOf("row-3");
    vi.advanceTimersByTime(400);

    timeline.resize("row-0", 150);
    timeline.layout.layoutScrollTo(timeline.layout.scrollTop - 30);

    expect(timeline.topOf("row-3")).toBe(before + 30);
  });

  it("ends a tap whose target left the document on pointerup, so content arriving after a send keeps the reader attached", () => {
    const timeline = createTimeline(rowsOf(10), { attached: true });
    const send = document.createElement("button");
    timeline.content.append(send);
    const pointer = (type: string) =>
      Object.assign(new Event(type, { bubbles: true }), {
        pointerType: "touch",
        pointerId: 7,
      });
    send.dispatchEvent(pointer("pointerdown"));
    send.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
    send.remove();
    window.dispatchEvent(pointer("pointerup"));

    timeline.setRows(rowsOf(12));
    timeline.layout.layoutScrollTo(timeline.layout.scrollTop - 120);

    expect(timeline.keeper.isAttached()).toBe(true);
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
  });

  it("ends the reader's fling session when the app scrolls to the bottom, so a send right after a fling stays attached", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const timeline = createTimeline(rowsOf(10), { attached: true });
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));
    timeline.layout.layoutScrollTo(timeline.layout.scrollTop - 600);
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchend"));
    vi.advanceTimersByTime(1_000);
    expect(timeline.keeper.isAttached()).toBe(false);

    timeline.keeper.scrollToBottom();
    timeline.setRows(rowsOf(12));
    timeline.layout.layoutScrollTo(timeline.layout.scrollTop - 120);

    expect(timeline.keeper.isAttached()).toBe(true);
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
  });

  it("jumps to the end and stays attached as content grows while the reader's finger is still down", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(400);
    expect(timeline.keeper.isAttached()).toBe(false);
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));

    timeline.keeper.scrollToBottom();
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);

    timeline.setRows(rowsOf(11));
    timeline.scrollElement.dispatchEvent(new Event("scroll"));
    timeline.layout.flushResizeObservers();

    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
    expect(timeline.keeper.isAttached()).toBe(true);
  });

  it("does not count a send button's jump to the end as the reader's gesture when the button handles pointerup itself", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(200);
    expect(timeline.keeper.isAttached()).toBe(false);
    const send = document.createElement("button");
    timeline.content.append(send);
    const pointer = (type: string) =>
      Object.assign(new Event(type, { bubbles: true }), {
        pointerType: "touch",
        pointerId: 9,
      });
    send.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      timeline.keeper.scrollToBottom();
      send.remove();
    });
    send.dispatchEvent(pointer("pointerdown"));
    send.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
    send.dispatchEvent(pointer("pointerup"));
    timeline.scrollElement.dispatchEvent(new TouchEvent("touchend"));

    timeline.setRows(rowsOf(12));
    timeline.layout.layoutScrollTo(timeline.layout.scrollTop - 120);

    expect(timeline.keeper.isAttached()).toBe(true);
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());
  });

  it("leaves an iOS edge bounce alone instead of holding it with a transform", () => {
    const timeline = createTimeline(rowsOf(10), { deferWrites: true });
    timeline.userScrollTo(300);
    const before = timeline.topOf("row-1");

    timeline.scrollElement.dispatchEvent(new TouchEvent("touchstart"));
    timeline.layout.bounceTo(-40);
    timeline.keeper.reconcile();

    expect(timeline.content.style.transform).toBe("");
    expect(timeline.topOf("row-1")).toBe(before + 340);
  });

  it("restores a saved row at its saved offset once it mounts, and stays at the end until then", () => {
    const rows = rowsOf(10);
    const timeline = createTimeline(rows.slice(5), { attached: true });

    timeline.keeper.restore({
      rowId: "row-3",
      offsetWithinRow: 40,
      atBottom: false,
    });
    expect(timeline.layout.scrollTop).toBe(timeline.layout.maxScrollTop());

    timeline.setRows(rows);
    timeline.keeper.reconcile();

    expect(timeline.topOf("row-3")).toBe(-40);
    expect(timeline.keeper.isAttached()).toBe(false);
    expect(timeline.keeper.savedPosition()).toEqual({
      rowId: "row-4",
      offsetWithinRow: -160,
      atBottom: false,
    });
  });

  it("restores a saved row where it stays visible when the viewport is now shorter than its offset", () => {
    const timeline = createTimeline(rowsOf(10), { footerTop: 120 });

    timeline.keeper.restore({
      rowId: "row-4",
      offsetWithinRow: -300,
      atBottom: false,
    });

    expect(timeline.topOf("row-4")).toBe(72);
  });

  it("restores the exact view when the first row starting in it is too close to the bottom to restore there", () => {
    const rows = rowsOf(10).map((row) =>
      row.id === "row-2" ? { ...row, height: 480 } : row,
    );
    const first = createTimeline(rows);
    first.userScrollTo(410);
    expect(first.topOf("row-3")).toBe(470);
    const saved = first.keeper.savedPosition();
    if (saved === null) throw new Error("No saved position");
    restoreLayout?.();
    document.body.replaceChildren();

    const second = createTimeline(rows);
    second.keeper.restore(saved);

    expect(second.topOf("row-2")).toBe(-10);
    expect(second.topOf("row-3")).toBe(470);
  });

  it("keeps the reading row when every row reflows at a new width", () => {
    const timeline = createTimeline(rowsOf(10));
    timeline.userScrollTo(450);
    const before = timeline.topOf("row-3");

    for (let index = 0; index < 10; index += 1) {
      timeline.resize(`row-${index}`, 320);
    }
    timeline.keeper.reconcile();

    expect(timeline.topOf("row-3")).toBe(before);
  });
});
