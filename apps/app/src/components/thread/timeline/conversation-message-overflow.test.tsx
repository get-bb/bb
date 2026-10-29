// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import {
  BottomAnchorContext,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";
import {
  ConversationMessageOverflowToggle,
  useOverflowMeasurement,
} from "./conversation-message-overflow";
import { createInertScrollPositionKeeper } from "@/test/scroll-position-keeper";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function OverflowProbe({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const measurement = useOverflowMeasurement({
    axis: "vertical",
    elementRef: ref,
    enabled: true,
    measurementKey: name,
  });
  return <div ref={ref} data-testid={name} data-measurement={measurement} />;
}

describe("useOverflowMeasurement", () => {
  it("measures every row before its first paint and shares one observer for later changes", () => {
    let observerCallback: ResizeObserverCallback | null = null;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    const constructorSpy = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          constructorSpy();
          observerCallback = callback;
        }
        observe = observe;
        unobserve = unobserve;
        disconnect = disconnect;
      },
    );
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "first" ? 80 : 20;
      });
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(20);
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(20);
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(20);

    render(
      <>
        <OverflowProbe name="first" />
        <OverflowProbe name="second" />
      </>,
    );

    const first = screen.getByTestId("first");
    const second = screen.getByTestId("second");
    expect(first.dataset.measurement).toBe("overflowing");
    expect(second.dataset.measurement).toBe("fits");
    expect(constructorSpy).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledTimes(2);

    scrollHeight.mockReturnValue(20);
    act(() => {
      observerCallback?.(
        [
          { target: first } as unknown as ResizeObserverEntry,
          { target: second } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });

    expect(first.dataset.measurement).toBe("fits");
    expect(second.dataset.measurement).toBe("fits");
    expect(clientHeight).toHaveBeenCalled();
    expect(scrollWidth).toHaveBeenCalled();
    expect(clientWidth).toHaveBeenCalled();
  });
});

describe("ConversationMessageOverflowToggle", () => {
  function renderToggle({
    expanded,
    rowTop,
  }: {
    expanded: boolean;
    rowTop: number;
  }) {
    const scrollArea = document.createElement("div");
    vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 50, 100, 500),
    );
    const holdContentPosition = vi.fn<
      BottomAnchorContextValue["holdContentPosition"]
    >(({ update }) => update());
    const onToggle = vi.fn();
    const bottomAnchor: BottomAnchorContextValue = {
      getScrollElement: () => scrollArea,
      isAtBottom: true,
      scrollToBottom: vi.fn(),
      scrollElementIntoView: vi.fn(),
      positionKeeper: createInertScrollPositionKeeper(),
      holdContentPosition,
    };
    render(
      <BottomAnchorContext.Provider value={bottomAnchor}>
        <div data-timeline-row-id="row" data-testid="row">
          <ConversationMessageOverflowToggle
            expanded={expanded}
            onToggle={onToggle}
          />
        </div>
      </BottomAnchorContext.Provider>,
    );
    const row = screen.getByTestId("row");
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, rowTop, 100, 1_000),
    );
    fireEvent.click(screen.getByRole("button"));
    return { holdContentPosition, onToggle, row };
  }

  it("holds the row top when expanding, even if the top is offscreen", () => {
    const { holdContentPosition, onToggle, row } = renderToggle({
      expanded: false,
      rowTop: -200,
    });

    expect(holdContentPosition).toHaveBeenCalledWith(
      expect.objectContaining({ edge: "top", element: row }),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("holds the row bottom when collapsing a row whose top is offscreen", () => {
    const { holdContentPosition } = renderToggle({
      expanded: true,
      rowTop: -200,
    });

    expect(holdContentPosition).toHaveBeenCalledWith(
      expect.objectContaining({ edge: "bottom" }),
    );
  });

  it("holds the row top when collapsing a row whose top is visible", () => {
    const { holdContentPosition } = renderToggle({
      expanded: true,
      rowTop: 80,
    });

    expect(holdContentPosition).toHaveBeenCalledWith(
      expect.objectContaining({ edge: "top" }),
    );
  });
});
