// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineWindowedItems } from "./TimelineWindowedItems.js";
import {
  TimelineWindowedItemsLoader,
  type TimelineWindowedItemRenderState,
  type TimelineWindowInitialScroll,
} from "./TimelineWindowedItemsLoader.js";

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
  getScrollElement?: () => HTMLElement | null;
  initialScroll?: TimelineWindowInitialScroll;
  measurements?: Map<string, number>;
  onRenderItem?: (index: number) => void;
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
        alwaysMountedKeys={options?.alwaysMountedKeys}
        estimateItemHeight={() => 32}
        gap={0}
        getScrollElement={options?.getScrollElement ?? (() => scrollElement)}
        initialScroll={options?.initialScroll}
        itemKeys={ITEM_KEYS}
        measurements={measurements}
        renderItem={(index: number, state: TimelineWindowedItemRenderState) => {
          options?.onRenderItem?.(index);
          return (
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
        }}
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

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
});

describe("TimelineWindowedItems", () => {
  it("renders only the tail window from the first commit when it starts at the end", () => {
    const renderedIndexes = new Set<number>();

    renderWindowedItems({
      initialScroll: { kind: "end" },
      onRenderItem: (index) => renderedIndexes.add(index),
    });

    expect(renderedIndexes.has(0)).toBe(false);
    expect(Math.min(...renderedIndexes)).toBeGreaterThan(80);
    expect(screen.getByTestId("content-99")).toBeTruthy();
    expect(screen.getAllByTestId(/^wrapper-/).length).toBeLessThanOrEqual(
      3 + 2 * 8 + 1,
    );
  });

  it("renders the window around a saved row from the first commit", () => {
    const renderedIndexes = new Set<number>();

    renderWindowedItems({
      initialScroll: { kind: "item", key: "row-50" },
      onRenderItem: (index) => renderedIndexes.add(index),
    });

    expect(screen.getByTestId("content-50")).toBeTruthy();
    expect(renderedIndexes.has(0)).toBe(false);
    expect(renderedIndexes.has(99)).toBe(false);
  });

  it("adopts the scroll root's offset when the root attaches after the first commit", async () => {
    let attached = false;
    const renderedIndexes = new Set<number>();

    renderWindowedItems({
      getScrollElement: () => (attached ? scrollElement : null),
      initialScroll: { kind: "end" },
      onRenderItem: (index) => renderedIndexes.add(index),
    });
    expect(renderedIndexes.has(0)).toBe(false);
    expect(screen.getByTestId("content-99")).toBeTruthy();

    scrollElement.scrollTop = 1_600;
    attached = true;

    await waitFor(() => expect(screen.getByTestId("content-50")).toBeTruthy());
    expect(screen.queryByTestId("wrapper-99")).toBeNull();
    expect(scrollElement.scrollTop).toBe(1_600);
  });

  it("preserves visible row identity when crossing the windowing threshold in either direction", async () => {
    Object.defineProperty(scrollElement, "clientHeight", {
      configurable: true,
      value: 1_000,
    });
    Object.defineProperty(scrollElement, "offsetHeight", {
      configurable: true,
      value: 1_000,
    });
    const measurements = new Map<string, number>();
    const getScrollElement = () => scrollElement;
    const list = (count: number) => (
      <TimelineWindowedItemsLoader
        estimateItemHeight={() => 100}
        gap={0}
        getScrollElement={getScrollElement}
        itemKeys={ITEM_KEYS.slice(0, count)}
        measurements={measurements}
        renderItem={(index, state) => (
          <div
            key={ITEM_KEYS[index]}
            ref={state.itemRef}
            data-index={state.itemIndex}
            data-timeline-windowed-realized={String(state.isRealized)}
            style={state.itemStyle}
          >
            <input data-testid={`input-${index}`} defaultValue="draft" />
          </div>
        )}
      />
    );
    const view = render(list(19), { container: scrollElement });
    const inputs = screen.getAllByTestId(/^input-/);
    fireEvent.change(inputs[0]!, { target: { value: "unsaved edit" } });

    view.rerender(list(20));
    await waitFor(() =>
      expect(screen.getAllByTestId(/^input-/)).toHaveLength(20),
    );
    inputs.forEach((input, index) => {
      expect(screen.getByTestId(`input-${index}`)).toBe(input);
    });
    expect(screen.getByDisplayValue("unsaved edit")).toBe(inputs[0]);
    expect(
      scrollElement.querySelector<HTMLElement>("[data-timeline-virtual-spacer]")
        ?.style.height,
    ).toBe("640px");

    view.rerender(list(19));
    inputs.forEach((input, index) => {
      expect(screen.getByTestId(`input-${index}`)).toBe(input);
    });
    expect(screen.getByDisplayValue("unsaved edit")).toBe(inputs[0]);
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

  it("keeps visible content mounted during a programmatic scroll jump", async () => {
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
    ).toBe(0);
    const content = screen.getByTestId("content-50");
    expect(content).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("content-50")).toBe(content);
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
