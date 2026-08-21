// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomAnchorContext } from "@/components/ui/bottom-anchored-scroll-body";
import {
  SCROLL_FOOTER_ATTRIBUTE,
  useStickyFooterAvailableHeight,
} from "./useStickyFooterAvailableHeight";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setHeight(element: HTMLElement, height: number) {
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
}

function Probe({
  onHeight,
  testId = "form",
}: {
  onHeight: (height: number | null) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useStickyFooterAvailableHeight(ref);
  onHeight(height);
  return <div ref={ref} data-testid={testId} />;
}

function stubResizeObserver(): Array<() => void> {
  const observers: Array<() => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  return observers;
}

function scrollBodyContext(scrollElement: HTMLElement) {
  return {
    getScrollElement: () => scrollElement,
    isAtBottom: true,
    scrollToBottom: () => {},
    scrollElementIntoView: () => {},
    scrollElementIntoViewClampedToMaxScroll: () => {},
    captureScrollAnchor: () => {},
  };
}

describe("useStickyFooterAvailableHeight", () => {
  it("returns null outside a bottom-anchored scroll body", () => {
    const onHeight = vi.fn();
    render(<Probe onHeight={onHeight} />);
    expect(onHeight).toHaveBeenLastCalledWith(null);
  });

  it("subtracts sibling footer content from the scroll port height", () => {
    const observers = stubResizeObserver();
    const scrollElement = document.createElement("div");
    setHeight(scrollElement, 600);
    const onHeight = vi.fn();
    const { container } = render(
      <BottomAnchorContext.Provider value={scrollBodyContext(scrollElement)}>
        <div {...{ [SCROLL_FOOTER_ATTRIBUTE]: "" }} data-testid="footer">
          <Probe onHeight={onHeight} />
        </div>
      </BottomAnchorContext.Provider>,
    );
    const footer = container.querySelector<HTMLElement>(
      `[${SCROLL_FOOTER_ATTRIBUTE}]`,
    );
    const form = container.querySelector<HTMLElement>("[data-testid=form]");
    if (!footer || !form) throw new Error("missing fixture");

    // Footer is 500px tall; the form is 300px of it, so 200px are siblings
    // (goal card, safe-area padding, child banners). The form may use the
    // remaining 400px of the 600px scroll port.
    setHeight(footer, 500);
    setHeight(form, 300);
    act(() => {
      for (const observer of observers) observer();
    });
    expect(onHeight).toHaveBeenLastCalledWith(400);

    // The keyboard shrinks the scroll port: the budget follows.
    setHeight(scrollElement, 350);
    act(() => {
      for (const observer of observers) observer();
    });
    expect(onHeight).toHaveBeenLastCalledWith(150);

    // Less room than the form's own chrome: the value follows the measurement
    // instead of a floor, so the footer never grows past the scroll port.
    setHeight(scrollElement, 240);
    act(() => {
      for (const observer of observers) observer();
    });
    expect(onHeight).toHaveBeenLastCalledWith(40);
  });

  it("splits the budget between forms in the same footer without a feedback loop", () => {
    const observers = stubResizeObserver();
    const scrollElement = document.createElement("div");
    setHeight(scrollElement, 600);
    const onHeightA = vi.fn();
    const onHeightB = vi.fn();
    const { container } = render(
      <BottomAnchorContext.Provider value={scrollBodyContext(scrollElement)}>
        <div {...{ [SCROLL_FOOTER_ATTRIBUTE]: "" }}>
          <Probe onHeight={onHeightA} testId="a" />
          <Probe onHeight={onHeightB} testId="b" />
        </div>
      </BottomAnchorContext.Provider>,
    );
    const footer = container.querySelector<HTMLElement>(
      `[${SCROLL_FOOTER_ATTRIBUTE}]`,
    );
    const a = container.querySelector<HTMLElement>("[data-testid=a]");
    const b = container.querySelector<HTMLElement>("[data-testid=b]");
    if (!footer || !a || !b) throw new Error("missing fixture");

    // Two 500px forms plus 100px of fixed content: 1100px footer. Each form
    // gets half of the 500px left after the fixed content.
    setHeight(a, 500);
    setHeight(b, 500);
    setHeight(footer, 1100);
    act(() => {
      for (const observer of observers) observer();
    });
    expect(onHeightA).toHaveBeenLastCalledWith(250);
    expect(onHeightB).toHaveBeenLastCalledWith(250);

    // The forms adopt their budgets. Later observer passes must produce the
    // same numbers, or the two hooks would chase each other forever.
    setHeight(a, 250);
    setHeight(b, 250);
    setHeight(footer, 600);
    for (let pass = 0; pass < 3; pass += 1) {
      act(() => {
        for (const observer of observers) observer();
      });
      expect(onHeightA).toHaveBeenLastCalledWith(250);
      expect(onHeightB).toHaveBeenLastCalledWith(250);
    }
  });
});
