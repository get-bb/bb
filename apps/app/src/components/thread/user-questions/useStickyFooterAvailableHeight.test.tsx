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

function Probe({ onHeight }: { onHeight: (height: number | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useStickyFooterAvailableHeight(ref);
  onHeight(height);
  return <div ref={ref} data-testid="form" />;
}

describe("useStickyFooterAvailableHeight", () => {
  it("returns null outside a bottom-anchored scroll body", () => {
    const onHeight = vi.fn();
    render(<Probe onHeight={onHeight} />);
    expect(onHeight).toHaveBeenLastCalledWith(null);
  });

  it("subtracts sibling footer content from the scroll port height", () => {
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
    const scrollElement = document.createElement("div");
    setHeight(scrollElement, 600);
    const onHeight = vi.fn();
    const contextValue = {
      getScrollElement: () => scrollElement,
      isAtBottom: true,
      scrollToBottom: () => {},
      scrollElementIntoView: () => {},
      scrollElementIntoViewClampedToMaxScroll: () => {},
      captureScrollAnchor: () => {},
    };
    const { container } = render(
      <BottomAnchorContext.Provider value={contextValue}>
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
  });
});
