// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchoredScrollBody,
  useBottomAnchoredScroll,
} from "@/components/ui/bottom-anchored-scroll-body";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor";

// Real externals only: the ResizeObserver/rAF used by the scroll body are
// browser primitives jsdom omits, so they are stubbed; nothing in our own code
// is mocked. The ResizeObserver stub delivers what a browser delivers — an
// entry per observed target carrying its box sizes — so the resize path under
// test is the one production runs. The atom is read back from the real default
// jotai store the component writes to.

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

// The scroll port's content box is its client height and the content wrapper's
// border box is the port's scroll height: the pair the component derives its
// cached max offset from. The other box of each entry differs by 8px so a
// refresh that reads the wrong one shows up as a skewed max offset.
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
  // rAF is only used by the bottom-restore settle tail; run callbacks
  // synchronously so it never leaks across tests, but it is irrelevant to the
  // row-anchored restore paths under test.
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
  // A row the timeline has since unmounted reports an empty rect, as a
  // browser's disconnected element does.
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
  virtualized?: boolean;
}

function CapturePrependAnchorControl() {
  const bottomAnchor = useBottomAnchoredScroll();
  return (
    <button type="button" onClick={() => bottomAnchor?.captureScrollAnchor()}>
      Capture prepend anchor
    </button>
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

function renderTimeline({
  threadId,
  rowIds,
  showCapturePrependAnchorControl = false,
  showScrollToBottomControl = false,
  virtualized = false,
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
        {virtualized ? (
          <div data-timeline-row-list="top-level">
            <div data-timeline-virtual-spacer="">{rows}</div>
          </div>
        ) : (
          rows
        )}
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
    // Rows mounted by a later rerender are not in `rowElements`.
    getRow: (rowId: string) =>
      requireHTMLElement(
        view.container.querySelector(`[data-timeline-row-id="${rowId}"]`),
      ),
    rerenderRows: (nextRowIds: string[]) => view.rerender(timeline(nextRowIds)),
    unmount: view.unmount,
  };
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
  // Reset the in-memory anchors so tests don't leak captured state.
  const store = getDefaultStore();
  for (const threadId of ["thread-a", "thread-b"]) {
    store.set(threadTimelineScrollAnchorAtomFamily(threadId), null);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BottomAnchoredScrollBody scroll preservation", () => {
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
    // row-a fully above the viewport; row-b is the first still visible, scrolled
    // 20px past its own top; row-c below it.
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
    // Content lays out settled at the bottom; the ResizeObserver delivery
    // refreshes the component's cached max scroll offset, exactly as a real
    // browser does whenever the scroll port or content wrapper resizes.
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    // User-intent scroll away from bottom, then a scroll event triggers capture.
    scrollArea.scrollTop = 150;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);

    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
  });

  it("captures rows nested in a virtualizer spacer", () => {
    const { scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
      virtualized: true,
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

  it("follows the row window when a windowed timeline slides it without a resize", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { scrollArea, getRow, rerenderRows, unmount } = renderTimeline({
      threadId: "thread-a",
      // row-z is the timeline's last row, which the windowed list keeps
      // mounted whatever the window holds.
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

    // Past the throttle window, so each capture below writes immediately.
    vi.advanceTimersByTime(1_000);
    scrollArea.scrollTop = 1_000;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    // A flick shorter than the overscan slides the window inside the
    // fixed-height spacer: row-b and row-c unmount, row-x and row-y mount
    // above row-a, and row-a and row-z stay connected. No observed box
    // changed size, so the ResizeObserver never fires.
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

    // Leaving the thread flushes a final capture from the same row set.
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

    // Chromium's native scroll anchoring can move the scrollport to its
    // temporary maximum before the explicit prepend compensation runs.
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    fireEvent.scroll(scrollArea);

    // More of the prepended content settles. Sticky-bottom must still be off,
    // or this resize moves scrollTop from 300 to the new maximum (400).
    setScrollMetrics(scrollArea, {
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: scrollArea.scrollTop,
    });
    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(300);

    // The browser-induced scroll event must not replace the explicit anchor
    // captured at 150; the 100px prepend therefore restores to 250.
    rerenderRows(["older-row", "row-a", "row-b", "row-c"]);
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

    // The request remains in flight while the user keeps scrolling upward.
    scrollArea.scrollTop = 100;
    fireEvent.wheel(scrollArea, { deltaY: -50 });
    fireEvent.scroll(scrollArea);

    // One 100px row is prepended. Preserve the user's newer 100px position,
    // not the stale 150px position captured when loading began.
    setScrollMetrics(scrollArea, {
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: scrollArea.scrollTop,
    });
    rerenderRows(["older-row", "row-a", "row-b", "row-c"]);

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
    // On remount row-b's top sits 200px down from the scroll area's top, so
    // revealing it requires scrollTop 200; the within-row offset adds 20.
    mockRowRect(requireHTMLElement(rowElements.get("row-b")!), {
      top: 200,
      bottom: 300,
    });
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 0,
    });

    // The mount layout effect already ran during render; re-driving the
    // ResizeObserver settle path applies the restore against the mocked rects.
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

    // Capture records at-bottom, not a row.
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

    // A bottom anchor must not pull the view to a row; scrollTop stays at bottom.
    expect(scrollArea.scrollTop).toBe(300);
    expect(rowBScrollSpy).not.toHaveBeenCalled();
  });

  it("falls back to the bottom when the saved row never appears", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "row-gone",
      offsetWithinRow: 20,
      atBottom: false,
    });

    // The saved row id isn't among the rendered rows (it was deleted/never
    // hydrated), so restore can never anchor to it.
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

    // Exhaust the settle attempts. The mount layout effect consumed the first of
    // the 8 attempts, so 7 ResizeObserver passes drive the remainder to zero; the
    // final pass re-enables stick-to-bottom and scrolls to the bottom inline.
    // (No surplus trigger here: an extra pass after the fallback would scroll to
    // bottom via `handleScrollAreaResize`'s own `queueBottomRestore`, masking a
    // fallback that forgot to scroll.)
    const observer = getLatestResizeObserver();
    for (let attempt = 0; attempt < 7; attempt += 1) {
      observer.trigger();
    }

    expect(scrollArea.scrollTop).toBe(300);
  });

  it("does not let a pending saved-row restore undo an explicit bottom scroll", () => {
    getDefaultStore().set(threadTimelineScrollAnchorAtomFamily("thread-a"), {
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    const { getByRole, scrollArea, rowElements } = renderTimeline({
      threadId: "thread-a",
      rowIds: ["row-a", "row-b", "row-c"],
      showScrollToBottomControl: true,
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

    fireEvent.click(getByRole("button", { name: "Bottom" }));
    expect(scrollArea.scrollTop).toBe(300);

    getLatestResizeObserver().trigger();

    expect(scrollArea.scrollTop).toBe(300);
  });

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
      // Layout/streaming has temporarily left us visibly off the physical bottom,
      // but no user scroll intent disabled sticky-bottom.
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
    // Leave A mid-timeline at row-b.
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

    // Switch to B and leave it mid-timeline at a different row.
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

    // Each thread's atom holds its own row, keyed independently.
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

    // Return to A: it must restore A's row (a-row-2), not B's.
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

    // From here on, every scrollHeight/clientHeight read is observable. On an
    // unvirtualized timeline those getters force a full synchronous layout
    // pass, so scroll/wheel handlers must run on the cached max offset alone.
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

    // The attach -> detach edge is allowed exactly one verification read (the
    // content-shrink guard re-testing the cached off-bottom classification).
    scrollArea.scrollTop = 150;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readScrollHeight).toHaveBeenCalledTimes(1);
    expect(readClientHeight).toHaveBeenCalledTimes(1);
    readScrollHeight.mockClear();
    readClientHeight.mockClear();

    // Steady state — a mid-timeline scroll burst, a wheel-down, and a return
    // to the bottom — must be entirely read-free.
    for (let scrollTop = 140; scrollTop >= 50; scrollTop -= 10) {
      scrollArea.scrollTop = scrollTop;
      fireEvent.scroll(scrollArea);
    }
    fireEvent.wheel(scrollArea, { deltaY: 120 });
    scrollArea.scrollTop = 300;
    fireEvent.scroll(scrollArea);

    expect(readScrollHeight).not.toHaveBeenCalled();
    expect(readClientHeight).not.toHaveBeenCalled();
    // The cached geometry still classified the burst correctly: the detach
    // captured the top-most visible row mid-timeline...
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
    // ...and the final scroll re-attached to the bottom, so the next growth
    // (a legitimate fresh read in the resize path) restores to the new max.
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
    // Pinned at the bottom of settled content; the cached max offset is 300.
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 300,
    });
    getLatestResizeObserver().trigger();

    // iOS tap-collapsing a long tool output while pinned: the touch marks
    // user intent, the content shrinks (new max offset 100), and the browser
    // clamps scrollTop and delivers the scroll event BEFORE the
    // ResizeObserver refresh — the cache still says 300.
    fireEvent.touchStart(scrollArea);
    setScrollMetrics(scrollArea, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 100,
    });
    fireEvent.scroll(scrollArea);

    // The stale-high cache reads 200px off-bottom with recent intent, which
    // would detach for good (the bottom-restore is suppressed once
    // stick-to-bottom is off) and persist a mid-timeline row anchor. The
    // detach-edge verification must keep us pinned instead.
    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });

    // The late resize delivery finds stick-to-bottom intact, so further
    // content growth keeps following the bottom.
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

    // Detach: against the cached max offset (300), 100 is far off the bottom.
    scrollArea.scrollTop = 100;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    // Content doubles while detached: the resize refreshes the cache (max
    // offset 700) without yanking the detached viewport.
    setScrollMetrics(scrollArea, {
      scrollHeight: 800,
      clientHeight: 100,
      scrollTop: 100,
    });
    getLatestResizeObserver().trigger();
    expect(scrollArea.scrollTop).toBe(100);

    // 694 is 6px shy of the refreshed bottom (700), outside the 4px threshold:
    // still detached. The stale pre-resize max (300) would misclassify it as
    // at-bottom and the growth below would yank to the new maximum.
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

    // 797 is 3px shy of the again-refreshed bottom (800): re-attaches...
    fireEvent.wheel(scrollArea, { deltaY: 200 });
    scrollArea.scrollTop = 797;
    fireEvent.scroll(scrollArea);

    // ...so the next content growth follows the bottom again.
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

    // The user scrolls up to read: detached mid-timeline.
    scrollArea.scrollTop = 150;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });

    // Tap-collapsing a long tool output below the viewport shrinks the content
    // past the viewport's position: the browser clamps scrollTop onto the new
    // maximum (100) and delivers that scroll event BEFORE the ResizeObserver
    // refresh, so the scroll handler still classifies against the stale cache
    // (300) and cannot see that the viewport now sits on the bottom.
    fireEvent.touchStart(scrollArea);
    setScrollMetrics(scrollArea, {
      scrollHeight: 200,
      clientHeight: 100,
      scrollTop: 100,
    });
    fireEvent.scroll(scrollArea);

    // The late resize delivery finds a detached viewport on the fresh bottom
    // after a shrink and re-attaches it, exactly as the live read did before
    // the cache: the anchor records at-bottom...
    getLatestResizeObserver().trigger();
    expect(readAnchor("thread-a")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });

    // ...and further content growth follows the bottom again.
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

    // A collapse far below the viewport: no clamp, no scroll event, and the
    // viewport (200 of a new max 500) is still well off the bottom.
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
});
