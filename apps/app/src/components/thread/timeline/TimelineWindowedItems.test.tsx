// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  TimelineWindowedItems,
  type TimelineWindowedItemRenderState,
} from "./TimelineWindowedItems.js";
import {
  TimelineWindowedItemsLoader,
  TimelineWindowingGeometryRevisionContext,
} from "./TimelineWindowedItemsLoader.js";

const ITEM_KEYS = Array.from({ length: 100 }, (_, index) => `row-${index}`);

let scrollElement: HTMLDivElement;
let itemHeights = new Map<number, number>();
/** Height of content above the windowed container inside the scroll root. */
let spacerOffsetTop = 0;

function rect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 320,
    top,
    width: 320,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

class ResizeObserverStub implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

function renderWindowedItems(options?: {
  alwaysMountedKeys?: ReadonlySet<string>;
  clientHeight?: number;
  enabled?: boolean;
  isCompactViewport?: boolean;
  measurements?: Map<string, number>;
}) {
  const measurements = options?.measurements ?? new Map<string, number>();
  Object.defineProperty(scrollElement, "clientHeight", {
    configurable: true,
    value: options?.clientHeight ?? 96,
  });
  Object.defineProperty(scrollElement, "offsetHeight", {
    configurable: true,
    value: options?.clientHeight ?? 96,
  });
  // Stable identities so a rerender only commits what a test changes.
  const estimateItemHeight = () => 32;
  const getScrollElement = () => scrollElement;
  const renderItem = (
    index: number,
    state: TimelineWindowedItemRenderState,
  ) => (
    <div
      key={ITEM_KEYS[index]}
      ref={state.itemRef}
      data-index={state.itemIndex}
      data-testid={`wrapper-${index}`}
      data-timeline-window-key={ITEM_KEYS[index]}
      data-timeline-windowed-realized={String(state.isRealized)}
      style={state.itemStyle}
    >
      {state.isRealized ? (
        <button type="button" data-testid={`content-${index}`}>
          row {index}
        </button>
      ) : null}
    </div>
  );
  const buildElement = (geometryRevision: number) => (
    <CompactViewportOverrideProvider
      isCompactViewport={options?.isCompactViewport ?? false}
    >
      <TimelineWindowingGeometryRevisionContext.Provider
        value={geometryRevision}
      >
        <TimelineWindowedItems
          enabled={options?.enabled ?? true}
          alwaysMountedKeys={options?.alwaysMountedKeys}
          estimateItemHeight={estimateItemHeight}
          gap={0}
          getScrollElement={getScrollElement}
          itemKeys={ITEM_KEYS}
          measurements={measurements}
          renderItem={renderItem}
        />
      </TimelineWindowingGeometryRevisionContext.Provider>
    </CompactViewportOverrideProvider>
  );
  let geometryRevision = 0;
  const view = render(buildElement(geometryRevision), {
    container: scrollElement,
  });
  return {
    ...view,
    measurements,
    /** Commit with fresh element identity but no geometry trigger. */
    rerenderWithoutGeometryTrigger: () => {
      view.rerender(buildElement(geometryRevision));
    },
    rerenderWithGeometryRevision: (revision: number) => {
      geometryRevision = revision;
      view.rerender(buildElement(revision));
    },
  };
}

function createScrollElement() {
  scrollElement = document.createElement("div");
  document.body.append(scrollElement);
  Object.defineProperty(scrollElement, "clientWidth", {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(scrollElement, "offsetWidth", {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(scrollElement, "scrollHeight", {
    configurable: true,
    value: 3_200,
  });
}

beforeEach(() => {
  itemHeights = new Map();
  spacerOffsetTop = 0;
  createScrollElement();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this === scrollElement) return rect(0, scrollElement.clientHeight);
      if (this.hasAttribute("data-timeline-virtual-spacer")) {
        return rect(
          spacerOffsetTop - scrollElement.scrollTop,
          Number.parseFloat(this.style.height) || 0,
        );
      }
      const index = Number(this.dataset.index);
      if (Number.isInteger(index)) {
        return rect(
          index * 32 - scrollElement.scrollTop,
          itemHeights.get(index) ?? 32,
        );
      }
      return rect(0, Number.parseFloat(this.style.height) || 0);
    },
  );
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TimelineWindowedItems", () => {
  it("seeds exact heights for a bounded trailing region while the lazy windowing implementation loads", () => {
    const measurements = new Map<string, number>();

    render(
      <TimelineWindowedItemsLoader
        enabled
        estimateItemHeight={() => 100}
        gap={0}
        getScrollElement={() => scrollElement}
        itemKeys={ITEM_KEYS}
        measurements={measurements}
        renderItem={(index, state) => (
          <div
            key={ITEM_KEYS[index]}
            ref={state.itemRef}
            data-index={state.itemIndex}
          />
        )}
      />,
      { container: scrollElement },
    );

    // The fallback mounts and measures only the trailing bottom-anchor
    // region, not all 100 loaded rows.
    expect(measurements.get("row-99")).toBe(32);
    expect(measurements.get("row-40")).toBe(32);
    expect(measurements.has("row-39")).toBe(false);
    expect(measurements.size).toBe(60);
  });

  it("keeps the control path fully mounted when the experiment is off", () => {
    renderWindowedItems({ enabled: false });

    expect(screen.getAllByTestId(/^content-/)).toHaveLength(100);
    expect(
      scrollElement.querySelector("[data-timeline-virtual-spacer]"),
    ).toBeNull();
  });

  it("mounts only the visible TanStack range and removes offscreen wrappers", async () => {
    renderWindowedItems();

    await waitFor(() => expect(screen.getByTestId("content-0")).toBeTruthy());
    expect(screen.getAllByTestId(/^wrapper-/).length).toBeLessThan(30);
    expect(screen.queryByTestId("wrapper-60")).toBeNull();
    expect(
      scrollElement.querySelector<HTMLElement>("[data-timeline-virtual-spacer]")
        ?.style.height,
    ).toBe("3200px");
  });

  it("changes ranges on scroll without retaining the old rich rows", async () => {
    renderWindowedItems();
    await waitFor(() => expect(screen.getByTestId("content-0")).toBeTruthy());

    scrollElement.scrollTop = 1_600;
    fireEvent.scroll(scrollElement);

    await waitFor(() => expect(screen.getByTestId("content-50")).toBeTruthy());
    expect(screen.queryByTestId("wrapper-0")).toBeNull();
  });

  it("preserves an existing scroll offset when a nested virtualizer mounts", async () => {
    scrollElement.scrollTop = 1_600;

    renderWindowedItems();

    await waitFor(() => expect(screen.getByTestId("content-50")).toBeTruthy());
    expect(scrollElement.scrollTop).toBe(1_600);
  });

  it("keeps search and interacted rows mounted outside the visible range", async () => {
    renderWindowedItems({ alwaysMountedKeys: new Set(["row-80"]) });
    await waitFor(() => expect(screen.getByTestId("content-80")).toBeTruthy());
    fireEvent.click(screen.getByTestId("content-0"));

    scrollElement.scrollTop = 1_600;
    fireEvent.scroll(scrollElement);

    await waitFor(() => expect(screen.getByTestId("content-50")).toBeTruthy());
    expect(screen.getByTestId("content-0")).toBeTruthy();
    expect(screen.getByTestId("content-80")).toBeTruthy();
  });

  it("defers rich transient rows during a fast traversal until scroll idle", async () => {
    vi.useFakeTimers();
    renderWindowedItems();
    await act(async () => {});

    scrollElement.scrollTop = 1_600;
    fireEvent.scroll(scrollElement);
    await act(async () => {});

    expect(
      scrollElement.querySelectorAll(
        '[data-timeline-windowed-realized="false"]',
      ).length,
    ).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("content-50")).toBeTruthy();
  });

  it("seeds its size model from measurements retained by the thread", async () => {
    const measurements = new Map<string, number>([["row-50", 64]]);
    renderWindowedItems({ measurements });
    await waitFor(() =>
      expect(
        scrollElement.querySelector<HTMLElement>(
          "[data-timeline-virtual-spacer]",
        )?.style.height,
      ).toBe("3232px"),
    );
  });

  it("renders everything when its scrollport has no usable geometry", async () => {
    renderWindowedItems({ clientHeight: 0 });

    await waitFor(() =>
      expect(screen.getAllByTestId(/^content-/)).toHaveLength(100),
    );
  });

  it("retains fewer overscan rows on compact viewports", async () => {
    renderWindowedItems();
    await waitFor(() => expect(screen.getByTestId("content-0")).toBeTruthy());
    const desktopWrappers = screen.getAllByTestId(/^wrapper-/).length;
    cleanup();
    createScrollElement();

    renderWindowedItems({ isCompactViewport: true });
    await waitFor(() => expect(screen.getByTestId("content-0")).toBeTruthy());
    const compactWrappers = screen.getAllByTestId(/^wrapper-/).length;

    // Same geometry, half the overscan (4 instead of 8). At the top only the
    // trailing side contributes, so the difference is one side's worth.
    expect(compactWrappers).toBe(desktopWrappers - 4);
  });

  it("re-reads scroll geometry only when a geometry trigger changes", async () => {
    const view = renderWindowedItems();
    await waitFor(() => expect(screen.getByTestId("content-0")).toBeTruthy());

    const boundingRectSpy = vi.mocked(
      HTMLElement.prototype.getBoundingClientRect,
    );
    const scrollElementReads = () =>
      boundingRectSpy.mock.contexts.filter(
        (context) => context === scrollElement,
      ).length;
    const settledReads = scrollElementReads();

    // A commit without a geometry trigger (a streaming delta that only
    // mutates row content) must not force a layout read.
    view.rerenderWithoutGeometryTrigger();
    expect(scrollElementReads()).toBe(settledReads);

    // An expand/collapse path bumping the geometry revision costs exactly
    // one read.
    view.rerenderWithGeometryRevision(1);
    expect(scrollElementReads()).toBe(settledReads + 1);
  });

  it("re-reads scroll geometry when the owning row's expansion moves a nested list", async () => {
    scrollElement.scrollTop = 640;
    const view = renderWindowedItems();

    await waitFor(() => expect(screen.getByTestId("content-20")).toBeTruthy());
    expect(screen.queryByTestId("wrapper-2")).toBeNull();

    // The owning row expanded: 320px of content appeared above the nested
    // list without resizing the scroll root, and the expansion path bumped
    // the geometry revision.
    spacerOffsetTop = 320;
    view.rerenderWithGeometryRevision(1);

    await waitFor(() => expect(screen.getByTestId("wrapper-2")).toBeTruthy());
  });
});
