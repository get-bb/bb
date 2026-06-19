// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor";

// Real externals only: the ResizeObserver/rAF used by the scroll body are
// browser primitives jsdom omits, so they are stubbed; nothing in our own code
// is mocked. The atom is read back from the real default jotai store the
// component writes to.

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
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback([], this);
  }
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
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
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
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, rect.top, 100, rect.bottom - rect.top),
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
}

function renderTimeline({ threadId, rowIds }: RenderArgs) {
  const view = render(
    <BottomAnchoredScrollBody
      footer={<div>Footer</div>}
      maxWidthClassName="max-w-none"
      scrollAreaClassName={SCROLL_AREA_CLASS}
      scrollAnchorThreadId={threadId}
    >
      {rowIds.map((rowId) => (
        <div key={rowId} data-timeline-row-id={rowId}>
          {rowId}
        </div>
      ))}
    </BottomAnchoredScrollBody>,
  );

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

  return { scrollArea, rowElements, unmount: view.unmount };
}

function readAnchor(threadId: string) {
  return getDefaultStore().get(
    threadTimelineScrollAnchorAtomFamily(threadId),
  );
}

beforeEach(() => {
  ResizeObserverMock.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  installAnimationFrameMocks();
});

afterEach(() => {
  cleanup();
  // Reset the in-memory anchors so tests don't leak captured state.
  const store = getDefaultStore();
  for (const threadId of ["thread-a", "thread-b"]) {
    store.set(threadTimelineScrollAnchorAtomFamily(threadId), null);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BottomAnchoredScrollBody scroll preservation", () => {
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
    setScrollMetrics(scrollArea, {
      scrollHeight: 400,
      clientHeight: 100,
      scrollTop: 150,
    });

    // User-intent scroll away from bottom, then a scroll event triggers capture.
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);

    expect(readAnchor("thread-a")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
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
      scrollTop: 150,
    });
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
      scrollTop: 150,
    });
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
});
