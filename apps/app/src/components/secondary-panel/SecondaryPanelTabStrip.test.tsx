// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  type SecondaryPanelFileTab,
  SecondaryPanelTabStrip,
} from "./SecondaryPanelTabStrip";

const noop = () => {};

interface BuildTabArgs {
  id: string;
  filename: string;
  isActive: boolean;
}

function buildTab({
  id,
  filename,
  isActive,
}: BuildTabArgs): SecondaryPanelFileTab {
  return {
    id,
    filename,
    isActive,
    isPinned: false,
    statusLabel: null,
    onSelect: noop,
    onClose: noop,
  };
}

function getViewport(): HTMLElement {
  const viewport = document.querySelector<HTMLElement>(".no-scrollbar");
  if (viewport === null) {
    throw new Error("Expected the tab strip scroll viewport to render");
  }
  return viewport;
}

/**
 * jsdom reports 0 for every layout metric, so the strip never looks
 * overflowing on its own. This stubs the geometry of the scroll viewport and
 * fires a scroll event so the component recomputes its overflow state.
 */
function simulateOverflow({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): void {
  const viewport = getViewport();
  Object.defineProperty(viewport, "scrollWidth", {
    configurable: true,
    value: scrollWidth,
  });
  Object.defineProperty(viewport, "clientWidth", {
    configurable: true,
    value: clientWidth,
  });
  Object.defineProperty(viewport, "scrollLeft", {
    configurable: true,
    writable: true,
    value: scrollLeft,
  });
  fireEvent.scroll(viewport);
}

/**
 * Dispatch a cancelable wheel event so the test can observe whether the strip
 * consumed it (`defaultPrevented`) or let it bubble for normal page scrolling.
 * The component attaches a non-passive native `wheel` listener directly on the
 * viewport, so dispatching to the viewport exercises that handler.
 */
function dispatchWheel(viewport: HTMLElement, deltaY: number): WheelEvent {
  const wheelEvent = new WheelEvent("wheel", {
    deltaY,
    deltaX: 0,
    bubbles: true,
    cancelable: true,
  });
  viewport.dispatchEvent(wheelEvent);
  return wheelEvent;
}

let scrollIntoViewSpy: Mock;
let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
let originalScrollBy: typeof Element.prototype.scrollBy;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // The shared test setup stubs scrollIntoView as a no-op; swap in a spy so the
  // auto-scroll path is observable, then restore the shared stub afterwards.
  originalScrollIntoView = Element.prototype.scrollIntoView;
  scrollIntoViewSpy = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewSpy;
  // jsdom doesn't implement scrollBy; remember it so individual tests can swap
  // in a spy and we can restore it afterwards.
  originalScrollBy = Element.prototype.scrollBy;
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  Element.prototype.scrollBy = originalScrollBy;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SecondaryPanelTabStrip", () => {
  it("hides both scroll chevrons when every tab fits", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: true }),
          buildTab({ id: "b", filename: "b.ts", isActive: false }),
        ]}
        usesDesktopChrome={false}
      />,
    );

    simulateOverflow({ scrollLeft: 0, scrollWidth: 200, clientWidth: 400 });

    expect(
      screen.queryByRole("button", { name: "Scroll tabs left" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Scroll tabs right" }),
    ).toBeNull();
  });

  it("shows only the right chevron at the start of an overflowing strip", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: true }),
          buildTab({ id: "b", filename: "b.ts", isActive: false }),
          buildTab({ id: "c", filename: "c.ts", isActive: false }),
        ]}
        usesDesktopChrome={false}
      />,
    );

    simulateOverflow({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });

    expect(
      screen.queryByRole("button", { name: "Scroll tabs left" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Scroll tabs right" }),
    ).not.toBeNull();
  });

  it("shows both chevrons when scrolled to the middle of an overflowing strip", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: true }),
          buildTab({ id: "b", filename: "b.ts", isActive: false }),
          buildTab({ id: "c", filename: "c.ts", isActive: false }),
        ]}
        usesDesktopChrome={false}
      />,
    );

    simulateOverflow({ scrollLeft: 250, scrollWidth: 800, clientWidth: 300 });

    expect(
      screen.getByRole("button", { name: "Scroll tabs left" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Scroll tabs right" }),
    ).not.toBeNull();
  });

  it("keeps desktop scroll chevrons split across the strip edges", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: true }),
          buildTab({ id: "b", filename: "b.ts", isActive: false }),
          buildTab({ id: "c", filename: "c.ts", isActive: false }),
        ]}
        usesDesktopChrome={true}
      />,
    );

    simulateOverflow({ scrollLeft: 250, scrollWidth: 800, clientWidth: 300 });

    const leftChevron = screen.getByRole("button", {
      name: "Scroll tabs left",
    });
    const rightChevron = screen.getByRole("button", {
      name: "Scroll tabs right",
    });

    expect(leftChevron.classList.contains("absolute")).toBe(true);
    expect(leftChevron.classList.contains("left-0")).toBe(true);
    expect(leftChevron.classList.contains("relative")).toBe(false);
    expect(leftChevron.classList.contains("right-0")).toBe(false);
    expect(leftChevron.getAttribute("tabindex")).toBe("-1");

    expect(rightChevron.classList.contains("absolute")).toBe(true);
    expect(rightChevron.classList.contains("right-0")).toBe(true);
    expect(rightChevron.classList.contains("relative")).toBe(false);
    expect(rightChevron.classList.contains("left-0")).toBe(false);
    expect(rightChevron.getAttribute("tabindex")).toBe("-1");
  });

  it("shows only the left chevron at the end of an overflowing strip", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: true }),
          buildTab({ id: "b", filename: "b.ts", isActive: false }),
          buildTab({ id: "c", filename: "c.ts", isActive: false }),
        ]}
        usesDesktopChrome={false}
      />,
    );

    // scrollLeft === scrollWidth - clientWidth → pinned to the right edge.
    simulateOverflow({ scrollLeft: 500, scrollWidth: 800, clientWidth: 300 });

    expect(
      screen.getByRole("button", { name: "Scroll tabs left" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Scroll tabs right" }),
    ).toBeNull();
  });

  it("nudges the viewport horizontally when a chevron is clicked", () => {
    const scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy;

    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: true }),
          buildTab({ id: "b", filename: "b.ts", isActive: false }),
          buildTab({ id: "c", filename: "c.ts", isActive: false }),
        ]}
        usesDesktopChrome={false}
      />,
    );

    simulateOverflow({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });

    fireEvent.click(screen.getByRole("button", { name: "Scroll tabs right" }));

    expect(scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
    const [firstCall] = scrollBy.mock.calls;
    expect(firstCall[0].left).toBeGreaterThan(0);
  });

  it("scrolls the active tab into view on mount and when the active tab changes", () => {
    const tabs = [
      buildTab({ id: "a", filename: "a.ts", isActive: true }),
      buildTab({ id: "b", filename: "b.ts", isActive: false }),
    ];

    const { rerender } = render(
      <SecondaryPanelTabStrip fileTabs={tabs} usesDesktopChrome={false} />,
    );

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

    rerender(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: false }),
          buildTab({ id: "b", filename: "b.ts", isActive: true }),
        ]}
        usesDesktopChrome={false}
      />,
    );

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2);
  });

  it("translates a vertical wheel delta into horizontal scrolling when it can scroll that way", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: true }),
          buildTab({ id: "b", filename: "b.ts", isActive: false }),
          buildTab({ id: "c", filename: "c.ts", isActive: false }),
        ]}
        usesDesktopChrome={false}
      />,
    );

    simulateOverflow({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    const viewport = getViewport();

    const wheelEvent = dispatchWheel(viewport, 120);

    expect(viewport.scrollLeft).toBe(120);
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  it("lets a downward wheel at the right edge scroll the page instead of trapping it", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: true }),
          buildTab({ id: "b", filename: "b.ts", isActive: false }),
          buildTab({ id: "c", filename: "c.ts", isActive: false }),
        ]}
        usesDesktopChrome={false}
      />,
    );

    // Pinned to the right edge: scrollLeft === scrollWidth - clientWidth.
    simulateOverflow({ scrollLeft: 500, scrollWidth: 800, clientWidth: 300 });
    const viewport = getViewport();

    const wheelEvent = dispatchWheel(viewport, 120);

    expect(viewport.scrollLeft).toBe(500);
    expect(wheelEvent.defaultPrevented).toBe(false);
  });

  it("lets an upward wheel at the left edge scroll the page instead of trapping it", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          buildTab({ id: "a", filename: "a.ts", isActive: true }),
          buildTab({ id: "b", filename: "b.ts", isActive: false }),
          buildTab({ id: "c", filename: "c.ts", isActive: false }),
        ]}
        usesDesktopChrome={false}
      />,
    );

    simulateOverflow({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    const viewport = getViewport();

    const wheelEvent = dispatchWheel(viewport, -120);

    expect(viewport.scrollLeft).toBe(0);
    expect(wheelEvent.defaultPrevented).toBe(false);
  });
});
