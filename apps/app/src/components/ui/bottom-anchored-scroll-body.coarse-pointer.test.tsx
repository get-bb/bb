// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor";

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
  for (const threadId of ["coarse-thread"]) {
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

    for (let scrollTop = 10; scrollTop <= 50; scrollTop += 10) {
      scrollArea.scrollTop = scrollTop;
      fireEvent.scroll(scrollArea);
    }
    expect(scrollArea.getAttribute("data-scrollbar-scrolling")).toBe("true");
    expect(attributeWrites.takeRecords()).toHaveLength(1);

    vi.runAllTimers();
    expect(scrollArea.hasAttribute("data-scrollbar-scrolling")).toBe(false);
    attributeWrites.disconnect();
  });

  it("captures scroll anchors at the relaxed coarse cadence", () => {
    stubMediaQueries(new Set(["(pointer: coarse)"]));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const { scrollArea } = renderTimeline("coarse-thread", ["row-a"]);

    vi.advanceTimersByTime(1_000);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("coarse-thread")).not.toBeNull();
    getDefaultStore().set(
      threadTimelineScrollAnchorAtomFamily("coarse-thread"),
      null,
    );

    vi.advanceTimersByTime(50);
    fireEvent.scroll(scrollArea);
    expect(readAnchor("coarse-thread")).toBeNull();

    vi.advanceTimersByTime(199);
    expect(readAnchor("coarse-thread")).toBeNull();

    vi.advanceTimersByTime(1);
    expect(readAnchor("coarse-thread")).toEqual({
      rowId: "",
      offsetWithinRow: 0,
      atBottom: true,
    });
  });
});
