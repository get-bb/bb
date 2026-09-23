// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchoredScrollBody,
  useBottomAnchoredScroll,
  type BottomAnchorContextValue,
} from "@/components/ui/bottom-anchored-scroll-body";

class ResizeObserverMock implements ResizeObserver {
  static instances: ResizeObserverMock[] = [];
  readonly targets: Element[] = [];

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("CSS", { supports: () => false });
});

afterEach(() => {
  ResizeObserverMock.instances.length = 0;
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderBody(): BottomAnchorContextValue {
  let captured: BottomAnchorContextValue | null = null;
  function Capture() {
    captured = useBottomAnchoredScroll();
    return <div data-timeline-row-id="row-a">row-a</div>;
  }
  render(
    <BottomAnchoredScrollBody
      footer={<div>Footer</div>}
      maxWidthClassName="max-w-none"
    >
      <Capture />
    </BottomAnchoredScrollBody>,
  );
  if (captured === null) {
    throw new Error("Scroll body did not provide its context");
  }
  return captured;
}

describe("BottomAnchoredScrollBody recent viewport change", () => {
  it("reports a scroll for 250 ms and then clears", () => {
    const now = vi.spyOn(window.performance, "now").mockReturnValue(1_000);
    const anchor = renderBody();
    const scrollArea = anchor.getScrollElement();
    if (scrollArea === null) {
      throw new Error("Scroll area was not rendered");
    }

    expect(anchor.hasRecentViewportChange?.()).toBe(false);

    act(() => {
      scrollArea.dispatchEvent(new Event("scroll"));
    });
    now.mockReturnValue(1_249);
    expect(anchor.hasRecentViewportChange?.()).toBe(true);

    now.mockReturnValue(1_251);
    expect(anchor.hasRecentViewportChange?.()).toBe(false);
  });

  it("reports a resize of the scroll area itself", () => {
    const now = vi.spyOn(window.performance, "now").mockReturnValue(5_000);
    const anchor = renderBody();
    const scrollArea = anchor.getScrollElement();
    const observer = ResizeObserverMock.instances.find((instance) =>
      instance.targets.includes(scrollArea as Element),
    );
    if (scrollArea === null || observer === undefined) {
      throw new Error("Scroll area was not observed");
    }

    now.mockReturnValue(6_000);
    expect(anchor.hasRecentViewportChange?.()).toBe(false);

    act(() => {
      observer.callback(
        [
          {
            target: scrollArea,
            contentRect: new DOMRect(0, 0, 200, 300),
            borderBoxSize: [{ blockSize: 300, inlineSize: 200 }],
            contentBoxSize: [{ blockSize: 300, inlineSize: 200 }],
            devicePixelContentBoxSize: [{ blockSize: 300, inlineSize: 200 }],
          },
        ],
        observer,
      );
    });
    now.mockReturnValue(6_100);
    expect(anchor.hasRecentViewportChange?.()).toBe(true);
  });
});
