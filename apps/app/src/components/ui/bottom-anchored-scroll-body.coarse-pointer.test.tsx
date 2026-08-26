// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor";

// Per-scroll-event costs on coarse pointers: the transient-scrollbar attribute
// is written once per scroll burst (the at-rest `.thread-scrollbar` rules hide
// the thumb on every platform, so a touch flick still has to flip it), the
// scroll-anchor capture throttle relaxes to the coarse cadence, and captures
// reuse a cached row NodeList that the ResizeObserver invalidates.

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

function stubMediaQueries(matching: ReadonlySet<string>): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: matching.has(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
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
    new DOMRect(0, 0, 100, 100),
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

function renderTimeline(threadId: string, rowIds: string[]) {
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
  return { scrollArea, rowElements };
}

function readAnchor(threadId: string) {
  return getDefaultStore().get(threadTimelineScrollAnchorAtomFamily(threadId));
}

beforeEach(() => {
  ResizeObserverMock.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  const store = getDefaultStore();
  for (const threadId of ["coarse-thread", "cache-thread"]) {
    store.set(threadTimelineScrollAnchorAtomFamily(threadId), null);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BottomAnchoredScrollBody on coarse pointers", () => {
  it("shows the transient scrollbar with one attribute write per scroll burst", () => {
    stubMediaQueries(new Set(["(pointer: coarse)"]));
    vi.useFakeTimers();
    const { scrollArea } = renderTimeline("coarse-thread", ["row-a"]);
    const attributeWrites = new MutationObserver(() => {});
    attributeWrites.observe(scrollArea, {
      attributes: true,
      attributeFilter: ["data-scrollbar-scrolling"],
    });

    // `.thread-scrollbar` paints the thumb transparent at rest on every
    // platform, and Android Chrome / iOS apply `scrollbar-color` to their
    // overlay indicators, so a touch flick still has to flip the attribute —
    // once per burst: the steady-state events must not re-set it, since each
    // attribute write is a style invalidation while the browser is scrolling.
    for (let scrollTop = 10; scrollTop <= 50; scrollTop += 10) {
      scrollArea.scrollTop = scrollTop;
      fireEvent.scroll(scrollArea);
    }
    expect(scrollArea.getAttribute("data-scrollbar-scrolling")).toBe("true");
    expect(attributeWrites.takeRecords()).toHaveLength(1);

    // The thumb hides again once scrolling goes idle.
    vi.runAllTimers();
    expect(scrollArea.hasAttribute("data-scrollbar-scrolling")).toBe(false);
    attributeWrites.disconnect();
  });

  it("captures scroll anchors at the relaxed coarse cadence", () => {
    stubMediaQueries(new Set(["(pointer: coarse)"]));
    // Fake performance.now so the throttle windows below are deterministic.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { scrollArea } = renderTimeline("coarse-thread", ["row-a"]);

    // Move the clock past the throttle window so the first capture writes
    // immediately, leaving the throttle's lastWriteAt equal to now. (Running
    // pending timers instead would also fire the scrollbar idle timeout and
    // advance the clock 600ms past that write.)
    vi.advanceTimersByTime(1_000);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("coarse-thread")).not.toBeNull();
    getDefaultStore().set(
      threadTimelineScrollAnchorAtomFamily("coarse-thread"),
      null,
    );

    // A capture 50ms into the window arms a trailing write for the remainder
    // of the coarse throttle: 250 - 50 = 200ms out.
    vi.advanceTimersByTime(50);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("coarse-thread")).toBeNull();

    // The fine-pointer cadence (100ms window → 50ms remainder) must not fire
    // on a coarse pointer...
    vi.advanceTimersByTime(199);
    expect(readAnchor("coarse-thread")).toBeNull();

    // ...but the trailing write still records the resting position at 250ms.
    vi.advanceTimersByTime(1);
    expect(readAnchor("coarse-thread")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
  });
});

describe("BottomAnchoredScrollBody row NodeList cache", () => {
  it("reuses the cached rows across captures until a resize invalidates them", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { scrollArea, rowElements } = renderTimeline("cache-thread", [
      "row-a",
      "row-b",
      "row-c",
    ]);
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
    const queryRows = vi.spyOn(scrollArea, "querySelectorAll");

    // Move the clock past the throttle window so every capture below writes
    // immediately instead of arming a trailing timeout.
    vi.advanceTimersByTime(1_000);
    scrollArea.scrollTop = 150;
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("cache-thread")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
    expect(queryRows).toHaveBeenCalledTimes(1);

    // A second capture in the same layout reuses the cached NodeList.
    vi.advanceTimersByTime(200);
    scrollArea.scrollTop = 140;
    fireEvent.scroll(scrollArea);
    expect(queryRows).toHaveBeenCalledTimes(1);

    // A ResizeObserver delivery means rows may have mounted or unmounted;
    // the next capture queries fresh.
    getLatestResizeObserver().trigger();
    vi.advanceTimersByTime(200);
    scrollArea.scrollTop = 130;
    fireEvent.scroll(scrollArea);
    expect(queryRows).toHaveBeenCalledTimes(2);
    expect(readAnchor("cache-thread")).toEqual({
      rowId: "row-b",
      offsetWithinRow: 20,
      atBottom: false,
    });
  });
});
