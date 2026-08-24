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
import {
  TimelineWindowedItems,
  type TimelineWindowedItemRenderState,
} from "./TimelineWindowedItems.js";
import { TimelineWindowedItemsLoader } from "./TimelineWindowedItemsLoader.js";

const ITEM_KEYS = Array.from({ length: 100 }, (_, index) => `row-${index}`);

let scrollElement: HTMLDivElement;
let itemHeights = new Map<number, number>();

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
  return {
    ...render(
      <TimelineWindowedItems
        enabled={options?.enabled ?? true}
        alwaysMountedKeys={options?.alwaysMountedKeys}
        estimateItemHeight={() => 32}
        gap={0}
        getScrollElement={() => scrollElement}
        itemKeys={ITEM_KEYS}
        measurements={measurements}
        renderItem={(index: number, state: TimelineWindowedItemRenderState) => (
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
        )}
      />,
      { container: scrollElement },
    ),
    measurements,
  };
}

beforeEach(() => {
  itemHeights = new Map();
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
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this === scrollElement) return rect(0, scrollElement.clientHeight);
      if (this.hasAttribute("data-timeline-virtual-spacer")) {
        return rect(
          -scrollElement.scrollTop,
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
  it("seeds exact heights while the lazy windowing implementation loads", () => {
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

    expect(measurements.get("row-0")).toBe(32);
    expect(measurements.get("row-99")).toBe(32);
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
});
