// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { useAutoLoadOlderRows } from "@/components/thread/timeline/useAutoLoadOlderRows";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchoredScrollBody,
  useBottomAnchoredScroll,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor";
import { scrollPageToTop } from "@/lib/page-scroll-to-top";

interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

interface RowRect {
  top: number;
  bottom: number;
}

const SCROLL_AREA_CLASS = "scroll-area";
const SCROLL_AREA_TOP = 0;
const SCROLL_AREA_HEIGHT = 100;

class ResizeObserverMock implements ResizeObserver {
  static instances: ResizeObserverMock[] = [];
  readonly callback: ResizeObserverCallback;
  readonly targets: Element[] = [];
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback(this.targets.map(makeResizeEntry), this);
  }
}

function makeResizeEntry(target: Element): ResizeObserverEntry {
  const isScrollPort = target.classList.contains(SCROLL_AREA_CLASS);
  const scrollPort = isScrollPort ? target : target.parentElement;
  if (!scrollPort) {
    throw new Error("Expected the content wrapper inside the scroll port.");
  }
  const contentBlockSize = isScrollPort
    ? scrollPort.clientHeight
    : scrollPort.scrollHeight - 8;
  const borderBlockSize = isScrollPort
    ? scrollPort.clientHeight + 8
    : scrollPort.scrollHeight;
  return {
    target,
    contentRect: new DOMRect(0, 0, 100, contentBlockSize),
    borderBoxSize: [{ blockSize: borderBlockSize, inlineSize: 100 }],
    contentBoxSize: [{ blockSize: contentBlockSize, inlineSize: 100 }],
    devicePixelContentBoxSize: [
      { blockSize: contentBlockSize, inlineSize: 100 },
    ],
  };
}

function getLatestResizeObserver(): ResizeObserverMock {
  const instance = ResizeObserverMock.instances.at(-1);
  if (!instance) throw new Error("Expected a ResizeObserver instance.");
  return instance;
}

function installAnimationFrameMocks() {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

function setScrollMetrics(element: HTMLElement, metrics: ScrollMetrics) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  element.scrollTop = metrics.scrollTop;
}

function mockScrollAreaRect(scrollArea: HTMLElement) {
  vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, SCROLL_AREA_TOP, 100, SCROLL_AREA_HEIGHT),
  );
}

function mockRowRect(row: HTMLElement, rect: RowRect) {
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(() =>
    row.isConnected
      ? new DOMRect(0, rect.top, 100, rect.bottom - rect.top)
      : new DOMRect(0, 0, 0, 0),
  );
}

function requireHTMLElement(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected HTMLElement.");
  }
  return element;
}

interface RenderArgs {
  threadId: string;
  rowIds: string[];
  showCapturePrependAnchorControl?: boolean;
  showScrollToBottomControl?: boolean;
  scrollIntoViewRowId?: string;
  virtualized?: boolean;
  onBottomAnchor?: (anchor: BottomAnchorContextValue | null) => void;
}

function BottomAnchorProbe({
  onBottomAnchor,
}: {
  onBottomAnchor: (anchor: BottomAnchorContextValue | null) => void;
}) {
  onBottomAnchor(useBottomAnchoredScroll());
  return null;
}

function CapturePrependAnchorControl() {
  const bottomAnchor = useBottomAnchoredScroll();
  const finishRef = useRef<((restore: boolean) => void) | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          finishRef.current = bottomAnchor?.captureScrollAnchor() ?? null;
        }}
      >
        Capture prepend anchor
      </button>
      <button type="button" onClick={() => finishRef.current?.(true)}>
        Finish prepend
      </button>
    </>
  );
}

function ScrollToBottomControl() {
  const bottomAnchor = useBottomAnchoredScroll();
  return (
    <button type="button" onClick={() => bottomAnchor?.scrollToBottom()}>
      Bottom
    </button>
  );
}

function ScrollRowIntoViewControl({ rowId }: { rowId: string }) {
  const bottomAnchor = useBottomAnchoredScroll();
  return (
    <button
      type="button"
      onClick={() => {
        const element = bottomAnchor
          ?.getScrollElement()
          ?.querySelector(`[data-timeline-row-id="${rowId}"]`);
        if (element instanceof HTMLElement) {
          bottomAnchor?.scrollElementIntoView({
            element,
            options: { block: "start", inline: "nearest" },
          });
        }
      }}
    >
      Reveal row
    </button>
  );
}

function renderTimeline({
  threadId,
  rowIds,
  showCapturePrependAnchorControl = false,
  showScrollToBottomControl = false,
  scrollIntoViewRowId,
  virtualized = false,
  onBottomAnchor,
}: RenderArgs) {
  const timeline = (renderedRowIds: string[]) => {
    const rows = renderedRowIds.map((rowId) => (
      <div key={rowId} data-timeline-row-id={rowId}>
        {rowId}
      </div>
    ));
    return (
      <BottomAnchoredScrollBody
        footer={<div>Footer</div>}
        maxWidthClassName="max-w-none"
        scrollAreaClassName={SCROLL_AREA_CLASS}
        scrollAnchorThreadId={threadId}
      >
        {showCapturePrependAnchorControl ? (
          <CapturePrependAnchorControl />
        ) : null}
        {showScrollToBottomControl ? <ScrollToBottomControl /> : null}
        {scrollIntoViewRowId ? (
          <ScrollRowIntoViewControl rowId={scrollIntoViewRowId} />
        ) : null}
        {onBottomAnchor ? (
          <BottomAnchorProbe onBottomAnchor={onBottomAnchor} />
        ) : null}
        <div data-timeline-row-list="top-level">
          <div
            data-timeline-items=""
            data-timeline-virtual-spacer={virtualized ? "" : undefined}
          >
            {rows}
          </div>
        </div>
      </BottomAnchoredScrollBody>
    );
  };
  const view = render(timeline(rowIds));

  const scrollArea = requireHTMLElement(
    view.container.querySelector(`.${SCROLL_AREA_CLASS}`),
  );
  const rowElements = new Map<string, HTMLElement>();
  for (const rowId of rowIds) {
    rowElements.set(
      rowId,
      requireHTMLElement(
        view.container.querySelector(`[data-timeline-row-id="${rowId}"]`),
      ),
    );
  }

  return {
    getByRole: view.getByRole,
    scrollArea,
    rowElements,
    getRow: (rowId: string) =>
      requireHTMLElement(
        view.container.querySelector(`[data-timeline-row-id="${rowId}"]`),
      ),
    rerenderRows: (nextRowIds: string[]) => view.rerender(timeline(nextRowIds)),
    unmount: view.unmount,
  };
}

function PaginatedRows({ load }: { load: () => Promise<() => void> }) {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { loadOlderRows } = useAutoLoadOlderRows({
    hasOlderTimelineRows: true,
    isLoadingOlderTimelineRows: loading,
    onLoadOlderRows: async (commit) => {
      setLoading(true);
      try {
        const update = await load();
        const apply = () => {
          update();
          setLoaded(true);
        };
        if (commit) await commit(apply);
        else apply();
      } finally {
        setLoading(false);
      }
    },
  });
  return (
    <>
      <button onClick={loadOlderRows}>Load page</button>
      <div data-timeline-row-id={loaded ? "older" : "current"}>Row</div>
    </>
  );
}

function readAnchor(threadId: string) {
  return getDefaultStore().get(threadTimelineScrollAnchorAtomFamily(threadId));
}

beforeEach(() => {
  ResizeObserverMock.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  installAnimationFrameMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  const store = getDefaultStore();
  for (const threadId of ["thread-a", "thread-b"]) {
    store.set(threadTimelineScrollAnchorAtomFamily(threadId), null);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BottomAnchoredScrollBody scroll preservation", () => {
  it("detaches from new messages when the page header scrolls to the top", () => {
    vi.useFakeTimers();
    const { scrollArea, getRow } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
    });
    const header = document.createElement("header");
    scrollArea.parentElement?.prepend(header);
    vi.spyOn(scrollArea, "getClientRects").mockReturnValue(
      Object.assign([new DOMRect(0, 0, 100, 100)], { item: () => null }),
    );
    Object.defineProperty(scrollArea, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(getRow("row-a"), { top: 0, bottom: 100 });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    scrollPageToTop(header);
    scrollArea.scrollTop = 298;
    fireEvent.scroll(scrollArea);
    vi.advanceTimersByTime(300);
    expect(readAnchor("thread-a")?.atBottom).toBe(false);

    scrollArea.scrollTop = 0;
    fireEvent.scroll(scrollArea);
    vi.advanceTimersByTime(300);

    expect(scrollArea.scrollTop).toBe(0);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-a",
      offsetWithinRow: 0,
      atBottom: false,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: 0,
    });
    getLatestResizeObserver().trigger();
    expect(scrollArea.scrollTop).toBe(0);
  });

  it("shows the thread scrollbar only while scroll events are active", () => {
    vi.useFakeTimers();
    const { scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
    });

    expect(scrollArea.classList).toContain("thread-scrollbar");
    expect(scrollArea.hasAttribute("data-scrollbar-scrolling")).toBe(false);

    fireEvent.scroll(scrollArea);

    expect(scrollArea.getAttribute("data-scrollbar-scrolling")).toBe("true");

    vi.runAllTimers();

    expect(scrollArea.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  });

  it("captures the top-most visible row when scrolled mid-timeline", () => {
    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -20,
      bottom: 80,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-c")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    scrollArea.scrollTop = 150;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);

    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
  });

  it.each([
    { top: -300, bottom: -200 },
    { top: 20, bottom: 60 },
  ])(
    "aligns an explicitly revealed row and notifies scroll listeners: %j",
    (rect) => {
      const { scrollArea, getRow, getByRole } = renderTimeline({
        threadId: "thread-a",
        rowIds: ["row-a", "row-b"],
        scrollIntoViewRowId: "row-a",
      });
      mockScrollAreaRect(scrollArea);
      const row = getRow("row-a");
      mockRowRect(row, rect);
      setScrollMetrics(scrollArea, {
        scrollHeight: 400,
        clientHeight: 100,
        scrollTop: 300,
      });
      getLatestResizeObserver().trigger();
      row.scrollIntoView = vi.fn(() => {
        scrollArea.scrollTop = 0;
      });
      const observedScrollTops: number[] = [];
      scrollArea.addEventListener("scroll", () => {
        observedScrollTops.push(scrollArea.scrollTop);
      });

      fireEvent.click(getByRole("button", { name: "Reveal row" }));

      expect(row.scrollIntoView).toHaveBeenCalledWith({
        block: "start",
        inline: "nearest",
      });
      expect(observedScrollTops).toEqual([0]);
    },
  );

  it("follows the row window when a windowed timeline slides it without a resize", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { scrollArea, getRow, rerenderRows, unmount } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c", "row-z"],
      virtualized: true,
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(getRow("row-a"), { top: -120, bottom: -20 });
    mockRowRect(getRow("row-b"), { top: -20, bottom: 80 });
    mockRowRect(getRow("row-c"), { top: 80, bottom: 180 });
    mockRowRect(getRow("row-z"), { top: 5_000, bottom: 5_100 });
    setScrollMetrics(scrollArea, {
      scrollHeight: 6_000,
      clientHeight: 100,
      scrollTop: 5_900,
    });
    getLatestResizeObserver().trigger();

    vi.advanceTimersByTime(1_000);
    scrollArea.scrollTop = 1_000;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    rerenderRows(["row-x", "row-y", "row-a", "row-z"]);
    mockRowRect(getRow("row-x"), { top: -130, bottom: -30 });
    mockRowRect(getRow("row-y"), { top: -30, bottom: 70 });
    mockRowRect(getRow("row-a"), { top: 70, bottom: 170 });
    vi.advanceTimersByTime(1_000);
    scrollArea.scrollTop = 900;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-y",
      offsetWithinRow: 30,
      atBottom: false,
    });

    unmount();
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-y",
      offsetWithinRow: 30,
      atBottom: false,
    });
  });

  it("finds the visible anchor with logarithmic row measurements", () => {
    const rowIds = Array.from({ length: 128 }, (_, index) => `row-${index}`);
    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds,
    });
    mockScrollAreaRect(scrollArea);
    const visibleIndex = 100;
    const rowRectSpies = rowIds.map((rowId, index) => {
      const top = (index - visibleIndex) * 10;
      const row = requireHTMLElement(rowElements.get(rowId)!);
      return vi
        .spyOn(row, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, top, 100, 10));
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_400,
      clientHeight: 100,
      scrollTop: 1_300,
    });
    getLatestResizeObserver().trigger();

    scrollArea.scrollTop = 1_000;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);

    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-100",
      offsetWithinRow: 0,
      atBottom: false,
    });
    expect(
      rowRectSpies.reduce(
        (measurementCount, spy) => measurementCount + spy.mock.calls.length,
        0,
      ),
    ).toBeLessThanOrEqual(8);
  });

  it.each(["success", "failure", "empty", "cancelled"] as const)(
    "settles a %s older-page request without waiting for a shell render",
    async (outcome) => {
      vi.useFakeTimers();
      let resolveLoad: (update: () => void) => void = () => {};
      let rejectLoad = () => {};
      const load = () =>
        new Promise<() => void>((resolve, reject) => {
          resolveLoad = resolve;
          rejectLoad = () => reject(new Error("offline"));
        });
      let showRows = true;
      const shell = () => (
        <BottomAnchoredScrollBody
          footer={<div>Footer</div>}
          maxWidthClassName="max-w-none"
          scrollAreaClassName={SCROLL_AREA_CLASS}
        >
          {showRows ? <PaginatedRows load={load} /> : null}
        </BottomAnchoredScrollBody>
      );
      const view = render(shell());
      const scrollArea = requireHTMLElement(
        view.container.querySelector(`.${SCROLL_AREA_CLASS}`),
      );
      setScrollMetrics(scrollArea, {
        scrollHeight: 1000,
        clientHeight: 100,
        scrollTop: 900,
      });
      getLatestResizeObserver().trigger();
      fireEvent.touchStart(scrollArea);
      scrollArea.scrollTop = 200;
      fireEvent.scroll(scrollArea);
      fireEvent.click(view.getByRole("button", { name: "Load page" }));
      if (outcome === "cancelled") {
        showRows = false;
        view.rerender(shell());
      }
      await act(async () => {
        if (outcome === "failure") rejectLoad();
        else
          resolveLoad(() => {
            if (outcome === "success")
              Object.defineProperty(scrollArea, "scrollHeight", {
                configurable: true,
                value: 1500,
              });
          });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(scrollArea.scrollHeight).toBe(1000);
      expect(scrollArea.scrollTop).toBe(200);
      fireEvent.touchEnd(scrollArea);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      scrollArea.scrollTop = 250;
      fireEvent.scroll(scrollArea);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(scrollArea.scrollHeight).toBe(1000);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      expect(scrollArea.scrollTop).toBe(outcome === "success" ? 750 : 250);
      fireEvent.touchStart(scrollArea);
      scrollArea.scrollTop = 400;
      fireEvent.scroll(scrollArea);
      setScrollMetrics(scrollArea, {
        scrollHeight: 1800,
        clientHeight: 100,
        scrollTop: 400,
      });
      view.rerender(shell());
      expect(scrollArea.scrollTop).toBe(400);
    },
  );

  it.each(["touchStart", "pointerDown", "wheel"] as const)(
    "holds the visible row while virtual heights settle and releases it on %s",
    (input) => {
      vi.useFakeTimers();
      const { getByRole, scrollArea, getRow } = renderTimeline({
        threadId: "thread-a",
        rowIds: ["row-a", "row-b"],
        showCapturePrependAnchorControl: true,
        virtualized: true,
      });
      setScrollMetrics(scrollArea, {
        scrollHeight: 1000,
        clientHeight: 100,
        scrollTop: 900,
      });
      getLatestResizeObserver().trigger();
      let rowTop = 100;
      mockScrollAreaRect(scrollArea);
      vi.spyOn(getRow("row-a"), "getBoundingClientRect").mockImplementation(
        () => new DOMRect(0, rowTop - scrollArea.scrollTop, 100, 300),
      );
      vi.spyOn(getRow("row-b"), "getBoundingClientRect").mockImplementation(
        () => new DOMRect(0, rowTop + 300 - scrollArea.scrollTop, 100, 300),
      );
      fireEvent.touchStart(scrollArea);
      scrollArea.scrollTop = 200;
      fireEvent.scroll(scrollArea);
      fireEvent.click(getByRole("button", { name: "Capture prepend anchor" }));
      rowTop = 600;
      setScrollMetrics(scrollArea, {
        scrollHeight: 2000,
        clientHeight: 100,
        scrollTop: 200,
      });
      fireEvent.click(getByRole("button", { name: "Finish prepend" }));
      expect(getRow("row-a").getBoundingClientRect().top).toBe(-100);
      rowTop = 800;
      setScrollMetrics(scrollArea, {
        scrollHeight: 2200,
        clientHeight: 100,
        scrollTop: 700,
      });
      getLatestResizeObserver().trigger();
      expect(scrollArea.scrollTop).toBe(900);
      scrollArea.scrollTop = 1000;
      fireEvent.scroll(scrollArea);
      expect(getRow("row-a").getBoundingClientRect().top).toBe(-100);
      fireEvent[input](scrollArea);
      scrollArea.scrollTop = 850;
      fireEvent.scroll(scrollArea);
      expect(scrollArea.scrollTop).toBe(850);
      rowTop = 1000;
      setScrollMetrics(scrollArea, {
        scrollHeight: 2400,
        clientHeight: 100,
        scrollTop: 850,
      });
      getLatestResizeObserver().trigger();
      expect(scrollArea.scrollTop).toBe(850);
    },
  );

  it("does not treat a native-anchor jump during prepend as bottom intent", () => {
    const { getByRole, rerenderRows, scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
      showCapturePrependAnchorControl: true,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    scrollArea.scrollTop = 150;
    fireEvent.wheel(scrollArea, { deltaY: -100 });
    fireEvent.scroll(scrollArea);
    fireEvent.click(getByRole("button", { name: "Capture prepend anchor" }));

    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    fireEvent.scroll(scrollArea);

    setScrollMetrics(scrollArea, {
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: scrollArea.scrollTop,
    });
    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(300);

    rerenderRows(["older-row", "row-a", "row-b", "row-c"]);
    fireEvent.click(getByRole("button", { name: "Finish prepend" }));
    expect(scrollArea.scrollTop).toBe(250);
  });

  it("preserves user scrolling that continues while older rows load", () => {
    const { getByRole, rerenderRows, scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
      showCapturePrependAnchorControl: true,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    scrollArea.scrollTop = 150;
    fireEvent.wheel(scrollArea, { deltaY: -100 });
    fireEvent.scroll(scrollArea);
    fireEvent.click(getByRole("button", { name: "Capture prepend anchor" }));

    scrollArea.scrollTop = 100;
    fireEvent.wheel(scrollArea, { deltaY: -50 });
    fireEvent.scroll(scrollArea);

    setScrollMetrics(scrollArea, {
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: scrollArea.scrollTop,
    });
    rerenderRows(["older-row", "row-a", "row-b", "row-c"]);
    fireEvent.click(getByRole("button", { name: "Finish prepend" }));

    expect(scrollArea.scrollTop).toBe(200);
  });

  it("restores near the saved row when returning to a thread", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: 200,
      bottom: 300,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    });

    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(220);
  });

  it("returns to the bottom when the thread was left at the bottom", () => {
    const { scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    fireEvent.scroll(scrollArea);

    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
  });

  it("does not restore a row when the saved anchor is at the bottom", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });

    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
    });
    mockScrollAreaRect(scrollArea);
    const rowB = requireHTMLElement(rowElements.get("row-b")!);
    const rowBScrollSpy = vi.spyOn(rowB, "getBoundingClientRect");
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });

    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(300);
    expect(rowBScrollSpy).not.toHaveBeenCalled();
  });

  it("falls back to the bottom when the saved row never appears", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "row-gone",
      offsetWithinRow: 20,
      atBottom: false,
    });

    const { scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
    });
    mockScrollAreaRect(scrollArea);
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    });

    const observer = getLatestResizeObserver();
    for (let attempt = 0; attempt < 7; attempt += 1) {
      observer.trigger();
    }

    expect(scrollArea.scrollTop).toBe(300);
  });

  it.each(["bottom", "message"])(
    "does not let a pending saved-row restore undo an explicit %s scroll",
    (destination) => {
      getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
        rowId: "row-b",
        offsetWithinRow: 20,
        atBottom: false,
      });

      const { getByRole, scrollArea, rowElements } = renderTimeline({
        threadId: "thread-a",
        rowIds: ["row-a", "row-b", "row-c"],
        showScrollToBottomControl: true,
        scrollIntoViewRowId: "row-a",
      });
      mockScrollAreaRect(scrollArea);
      mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
        top: -100,
        bottom: 0,
      });
      setScrollMetrics(scrollArea, {
        scrollHeight: 400,
        clientHeight: 100,
        scrollTop: 0,
      });

      const expectedScrollTop = destination === "bottom" ? 300 : 150;
      const row = requireHTMLElement(rowElements.get("row-a")!);
      row.scrollIntoView = vi.fn(() => {
        scrollArea.scrollTop = expectedScrollTop;
      });
      fireEvent.click(
        getByRole("button", {
          name: destination === "bottom" ? "Bottom" : "Reveal row",
        }),
      );
      expect(scrollArea.scrollTop).toBe(expectedScrollTop);

      getLatestResizeObserver().trigger();

      expect(scrollArea.scrollTop).toBe(expectedScrollTop);
    },
  );

  it("keeps sticking after manual scroll reaches bottom before more growth", () => {
    const { scrollArea } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);

    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    fireEvent.wheel(scrollArea, { deltaY: 1_000 });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    fireEvent.scroll(scrollArea);

    fireEvent.wheel(scrollArea, { deltaY: 200 });

    setScrollMetrics(scrollArea, {
      scrollHeight: 450,
      clientHeight: 100,
      scrollTop: scrollArea.scrollTop,
    });
    fireEvent.scroll(scrollArea);

    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });

    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(350);
  });

  it("preserves bottom intent when unmounting during transient off-bottom layout", () => {
    const { scrollArea, rowElements, unmount } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -20,
      bottom: 80,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 250,
    });

    unmount();

    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
  });

  it("preserves a user-scrolled row when unmounting before the scroll event", () => {
    const { scrollArea, rowElements, unmount } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -20,
      bottom: 80,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-c")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    fireEvent.wheel(scrollArea);
    unmount();

    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
  });

  it("restores thread A's own anchor after a fast A -> B -> A switch", () => {
    const a1 = renderTimeline({
      threadId: "thread-a",
      rowIds: ["a-row-1", "a-row-2", "a-row-3"],
    });
    mockScrollAreaRect(a1.scrollArea);
    mockRowRect(requireHTMLElement(a1.rowElements.get("a-row-1")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(a1.rowElements.get("a-row-2")!), {
      top: -20,
      bottom: 80,
    });
    mockRowRect(requireHTMLElement(a1.rowElements.get("a-row-3")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(a1.scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();
    a1.scrollArea.scrollTop = 150;
    fireEvent.wheel(a1.scrollArea);
    fireEvent.scroll(a1.scrollArea);
    a1.unmount();

    const b = renderTimeline({
      threadId: "thread-b",
      rowIds: ["b-row-1", "b-row-2"],
    });
    mockScrollAreaRect(b.scrollArea);
    mockRowRect(requireHTMLElement(b.rowElements.get("b-row-1")!), {
      top: -10,
      bottom: 90,
    });
    mockRowRect(requireHTMLElement(b.rowElements.get("b-row-2")!), {
      top: 90,
      bottom: 190,
    });
    setScrollMetrics(b.scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();
    b.scrollArea.scrollTop = 150;
    fireEvent.wheel(b.scrollArea);
    fireEvent.scroll(b.scrollArea);
    b.unmount();

    expect(readAnchor("thread-a")).toEqual({
      rowId: "a-row-2",
      offsetWithinRow: 20,
      atBottom: false,
    });
    expect(readAnchor("thread-b")).toEqual({
      rowId: "b-row-1",
      offsetWithinRow: 10,
      atBottom: false,
    });

    const a2 = renderTimeline({
      threadId: "thread-a",
      rowIds: ["a-row-1", "a-row-2", "a-row-3"],
    });
    mockScrollAreaRect(a2.scrollArea);
    mockRowRect(requireHTMLElement(a2.rowElements.get("a-row-2")!), {
      top: 200,
      bottom: 300,
    });
    setScrollMetrics(a2.scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    });

    getLatestResizeObserver().trigger();

    expect(a2.scrollArea.scrollTop).toBe(220);
  });

  it("never reads scrollHeight or clientHeight from per-scroll-event handlers", () => {
    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -20,
      bottom: 80,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-c")!), {
      top: 80,
      bottom: 180,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    const readScrollHeight = vi.fn(() => 400);
    const readClientHeight = vi.fn(() => 100);
    Object.defineProperty(scrollArea, "scrollHeight", {
      configurable: true,
      get: readScrollHeight,
    });
    Object.defineProperty(scrollArea, "clientHeight", {
      configurable: true,
      get: readClientHeight,
    });

    scrollArea.scrollTop = 150;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readScrollHeight).toHaveBeenCalledTimes(1);
    expect(readClientHeight).toHaveBeenCalledTimes(1);
    readScrollHeight.mockClear();
    readClientHeight.mockClear();

    for (let scrollTop = 140; scrollTop >= 50; scrollTop -= 10) {
      scrollArea.scrollTop = scrollTop;
      fireEvent.scroll(scrollArea);
    }
    fireEvent.wheel(scrollArea, { deltaY: 120 });
    scrollArea.scrollTop = 300;
    fireEvent.scroll(scrollArea);

    expect(readScrollHeight).not.toHaveBeenCalled();
    expect(readClientHeight).not.toHaveBeenCalled();
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();
    expect(scrollArea.scrollTop).toBe(400);
  });

  it("stays pinned when a shrink-frame scroll event outruns the resize refresh", () => {
    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -20,
      bottom: 80,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    fireEvent.touchStart(scrollArea);
    setScrollMetrics(scrollArea, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 100,
    });
    fireEvent.scroll(scrollArea);

    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });

    getLatestResizeObserver().trigger();
    setScrollMetrics(scrollArea, {
      scrollHeight: 250,
      clientHeight: 100,
      scrollTop: 100,
    });
    getLatestResizeObserver().trigger();
    expect(scrollArea.scrollTop).toBe(150);
  });

  it("tracks isAtBottom transitions against the cache refreshed by resizes", () => {
    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -20,
      bottom: 80,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    scrollArea.scrollTop = 100;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    setScrollMetrics(scrollArea, {
      scrollHeight: 800,
      clientHeight: 100,
      scrollTop: 100,
    });
    getLatestResizeObserver().trigger();
    expect(scrollArea.scrollTop).toBe(100);

    fireEvent.wheel(scrollArea, { deltaY: 400 });
    scrollArea.scrollTop = 694;
    fireEvent.scroll(scrollArea);

    setScrollMetrics(scrollArea, {
      scrollHeight: 900,
      clientHeight: 100,
      scrollTop: 694,
    });
    getLatestResizeObserver().trigger();
    expect(scrollArea.scrollTop).toBe(694);

    fireEvent.wheel(scrollArea, { deltaY: 200 });
    scrollArea.scrollTop = 797;
    fireEvent.scroll(scrollArea);

    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 797,
    });
    getLatestResizeObserver().trigger();
    expect(scrollArea.scrollTop).toBe(900);
  });

  it("re-attaches a detached viewport that a content shrink clamps onto the bottom", () => {
    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -20,
      bottom: 80,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    scrollArea.scrollTop = 150;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    fireEvent.touchStart(scrollArea);
    setScrollMetrics(scrollArea, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 100,
    });
    fireEvent.scroll(scrollArea);

    getLatestResizeObserver().trigger();
    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });

    setScrollMetrics(scrollArea, {
      scrollHeight: 250,
      clientHeight: 100,
      scrollTop: 100,
    });
    getLatestResizeObserver().trigger();
    expect(scrollArea.scrollTop).toBe(150);
  });

  it("leaves a detached viewport alone when content shrinks without reaching it", () => {
    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(requireHTMLElement(rowElements.get("row-a")!), {
      top: -120,
      bottom: -20,
    });
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: -20,
      bottom: 80,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 900,
    });
    getLatestResizeObserver().trigger();

    scrollArea.scrollTop = 200;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    setScrollMetrics(scrollArea, {
      scrollHeight: 600,
      clientHeight: 100,
      scrollTop: 200,
    });
    getLatestResizeObserver().trigger();
    expect(scrollArea.scrollTop).toBe(200);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
  });

  it("keeps a toggled row in place instead of following the bottom", () => {
    let bottomAnchor: BottomAnchorContextValue | null = null;
    const { scrollArea, getRow } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
      onBottomAnchor: (anchor) => {
        bottomAnchor = anchor;
      },
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(getRow("row-b"), { top: 20, bottom: 60 });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    act(() => {
      bottomAnchor?.holdContentPosition({
        edge: "top",
        element: getRow("row-b"),
        update: () => {
          setScrollMetrics(scrollArea, {
            scrollHeight: 2_000,
            clientHeight: 100,
            scrollTop: 300,
          });
        },
      });
    });
    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(300);
  });

  it("keeps a collapsing row's bottom edge in place when its top is offscreen", () => {
    let bottomAnchor: BottomAnchorContextValue | null = null;
    const { scrollArea, getRow } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
      onBottomAnchor: (anchor) => {
        bottomAnchor = anchor;
      },
    });
    mockScrollAreaRect(scrollArea);
    const row = getRow("row-b");
    mockRowRect(row, { top: -900, bottom: 60 });
    setScrollMetrics(scrollArea, {
      scrollHeight: 2_000,
      clientHeight: 100,
      scrollTop: 800,
    });

    act(() => {
      bottomAnchor?.holdContentPosition({
        edge: "bottom",
        element: row,
        update: () => {
          mockRowRect(row, { top: -900, bottom: -440 });
        },
      });
    });

    expect(scrollArea.scrollTop).toBe(300);
  });

  it("keeps following new content after a toggle that leaves the viewport at the bottom", () => {
    let bottomAnchor: BottomAnchorContextValue | null = null;
    const { scrollArea, getRow } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
      onBottomAnchor: (anchor) => {
        bottomAnchor = anchor;
      },
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(getRow("row-b"), { top: 20, bottom: 60 });
    setScrollMetrics(scrollArea, {
      scrollHeight: 100,
      clientHeight: 100,
      scrollTop: 0,
    });
    getLatestResizeObserver().trigger();

    act(() => {
      bottomAnchor?.holdContentPosition({
        edge: "top",
        element: getRow("row-b"),
        update: () => {},
      });
    });
    getLatestResizeObserver().trigger();
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    });
    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(300);
  });

  it("re-pins when collapsing a toggled row clamps a detached viewport onto the bottom", () => {
    let bottomAnchor: BottomAnchorContextValue | null = null;
    const { scrollArea, getRow } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
      onBottomAnchor: (anchor) => {
        bottomAnchor = anchor;
      },
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(getRow("row-b"), { top: 20, bottom: 60 });
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_100,
      clientHeight: 100,
      scrollTop: 910,
    });
    getLatestResizeObserver().trigger();
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);

    act(() => {
      bottomAnchor?.holdContentPosition({
        edge: "top",
        element: getRow("row-b"),
        update: () => {
          setScrollMetrics(scrollArea, {
            scrollHeight: 940,
            clientHeight: 100,
            scrollTop: 840,
          });
        },
      });
    });
    const observer = getLatestResizeObserver();
    const shrinkEntries = observer.targets.map(makeResizeEntry);
    setScrollMetrics(scrollArea, {
      scrollHeight: 960,
      clientHeight: 100,
      scrollTop: 840,
    });
    observer.callback(shrinkEntries, observer);

    expect(scrollArea.scrollTop).toBe(860);
  });

  it("suspends native scroll anchoring until overlapping holds finish", () => {
    vi.useFakeTimers();
    let bottomAnchor: BottomAnchorContextValue | null = null;
    const { scrollArea, getRow } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b"],
      onBottomAnchor: (anchor) => {
        bottomAnchor = anchor;
      },
    });
    mockScrollAreaRect(scrollArea);
    mockRowRect(getRow("row-b"), { top: 20, bottom: 60 });
    const hold = () =>
      act(() => {
        bottomAnchor?.holdContentPosition({
          edge: "top",
          element: getRow("row-b"),
          update: () => {},
        });
      });

    hold();
    vi.advanceTimersByTime(200);
    hold();
    vi.advanceTimersByTime(100);
    expect(scrollArea.style.overflowAnchor).toBe("none");

    vi.advanceTimersByTime(200);
    expect(scrollArea.style.overflowAnchor).toBe("");
  });
});
