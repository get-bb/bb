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
import { AutoHeightSnapContext } from "@/components/ui/height-transition";
import { TimelineWindowedItems } from "./TimelineWindowedItems.js";
import {
  TimelineWindowedItemsLoader,
  type TimelineWindowedItemRenderState,
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

const resizeObserverCallbacks = new Set<ResizeObserverCallback>();

class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObserverCallbacks.add(callback);
  }
  disconnect(): void {
    resizeObserverCallbacks.delete(this.callback);
  }
  observe(): void {}
  unobserve(): void {}
}

function reportItemResize(element: HTMLElement, height: number) {
  const entry = {
    target: element,
    borderBoxSize: [{ blockSize: height, inlineSize: 320 }],
    contentBoxSize: [{ blockSize: height, inlineSize: 320 }],
    contentRect: rect(0, height),
    devicePixelContentBoxSize: [],
  } satisfies ResizeObserverEntry;
  for (const callback of resizeObserverCallbacks) {
    callback([entry], new ResizeObserverStub(callback));
  }
}

function readSpacerHeight() {
  const spacer = scrollElement.querySelector<HTMLElement>(
    "[data-timeline-virtual-spacer]",
  );
  return Number.parseFloat(spacer?.style.height ?? "") || 0;
}

function clampScrollTopToContentHeight(readContentHeight: () => number) {
  let scrollTop = 0;
  const maxScrollTop = () =>
    Math.max(0, readContentHeight() - scrollElement.clientHeight);
  Object.defineProperty(scrollElement, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.min(Math.max(0, value), maxScrollTop());
    },
  });
  scrollElement.scrollTo = ((options: ScrollToOptions) => {
    if (options.top !== undefined) scrollElement.scrollTop = options.top;
  }) as typeof scrollElement.scrollTo;
}

function renderWindowedItems(options?: {
  alwaysMountedKeys?: ReadonlySet<string>;
  clientHeight?: number;
  measurements?: Map<string, number>;
  snapAutoHeight?: () => void;
  startAtEnd?: boolean;
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
      <AutoHeightSnapContext.Provider value={options?.snapAutoHeight ?? null}>
        <TimelineWindowedItems
          alwaysMountedKeys={options?.alwaysMountedKeys}
          estimateItemHeight={() => 32}
          gap={0}
          getScrollElement={() => scrollElement}
          itemKeys={ITEM_KEYS}
          measurements={measurements}
          startAtEnd={options?.startAtEnd ?? false}
          renderItem={(
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
          )}
        />
      </AutoHeightSnapContext.Provider>,
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
  resizeObserverCallbacks.clear();
  scrollElement.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TimelineWindowedItems", () => {
  it("never mounts the full history while the parent scroll ref is pending", async () => {
    const rendered = new Set<number>();
    let root: HTMLElement | null = null;
    Object.defineProperty(scrollElement, "clientHeight", { value: 96 });
    Object.defineProperty(scrollElement, "offsetHeight", { value: 96 });
    render(
      <div
        ref={() => {
          root = scrollElement;
        }}
      >
        <TimelineWindowedItems
          estimateItemHeight={() => 32}
          gap={0}
          getScrollElement={() => root}
          itemKeys={ITEM_KEYS}
          measurements={new Map()}
          startAtEnd={false}
          renderItem={(index, state) => {
            rendered.add(index);
            return (
              <div
                key={ITEM_KEYS[index]}
                ref={state.itemRef}
                data-index={state.itemIndex}
                style={state.itemStyle}
                data-testid={`pending-${index}`}
                data-timeline-windowed-realized="true"
              />
            );
          }}
        />
      </div>,
      { container: scrollElement },
    );
    await waitFor(() => expect(screen.getByTestId("pending-0")).toBeTruthy());
    expect(rendered.size).toBeLessThan(50);
    scrollElement.scrollTop = 1_600;
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    fireEvent.scroll(scrollElement);
    await waitFor(() => expect(screen.getByTestId("pending-50")).toBeTruthy());
    expect(screen.queryByTestId("pending-0")).toBeNull();
  });

  it("captures exact heights before the scrollport becomes usable", () => {
    const measurements = new Map<string, number>();

    render(
      <TimelineWindowedItemsLoader
        estimateItemHeight={() => 100}
        gap={0}
        getScrollElement={() => scrollElement}
        itemKeys={ITEM_KEYS}
        measurements={measurements}
        startAtEnd={false}
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
        startAtEnd={false}
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

  it("starts its range at the end of the list when pinned to the bottom", async () => {
    renderWindowedItems({ startAtEnd: true });

    await waitFor(() => expect(screen.getByTestId("content-98")).toBeTruthy());
    expect(screen.queryByTestId("wrapper-0")).toBeNull();
  });

  it("grows the list before compensating for a taller row above the viewport", async () => {
    clampScrollTopToContentHeight(readSpacerHeight);
    renderWindowedItems();
    await waitFor(() => expect(screen.getByTestId("content-0")).toBeTruthy());
    scrollElement.scrollTop = 3_104;
    fireEvent.scroll(scrollElement);
    await waitFor(() => expect(screen.getByTestId("content-98")).toBeTruthy());

    itemHeights.set(95, 332);
    act(() => {
      reportItemResize(screen.getByTestId("wrapper-95"), 332);
    });

    expect(
      scrollElement.querySelector<HTMLElement>("[data-timeline-virtual-spacer]")
        ?.style.height,
    ).toBe("3500px");
    expect(scrollElement.scrollTop).toBe(3_404);
  });

  it("settles the enclosing auto-height wrapper before compensating for a taller row", async () => {
    let wrapperHeight = 0;
    clampScrollTopToContentHeight(() => wrapperHeight);
    renderWindowedItems({
      snapAutoHeight: () => {
        wrapperHeight = readSpacerHeight();
      },
    });
    await waitFor(() => expect(screen.getByTestId("content-0")).toBeTruthy());
    wrapperHeight = readSpacerHeight();
    scrollElement.scrollTop = 3_104;
    fireEvent.scroll(scrollElement);
    await waitFor(() => expect(screen.getByTestId("content-98")).toBeTruthy());

    itemHeights.set(95, 332);
    act(() => {
      reportItemResize(screen.getByTestId("wrapper-95"), 332);
    });

    expect(wrapperHeight).toBe(3_500);
    expect(scrollElement.scrollTop).toBe(3_404);
  });

  it("renders everything when its scrollport has no usable geometry", async () => {
    renderWindowedItems({ clientHeight: 0 });

    await waitFor(() =>
      expect(screen.getAllByTestId(/^content-/)).toHaveLength(100),
    );
  });
});
