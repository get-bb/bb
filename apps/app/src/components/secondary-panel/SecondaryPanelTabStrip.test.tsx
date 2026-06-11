// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
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
  SecondaryPanelTabStrip as BaseSecondaryPanelTabStrip,
} from "./SecondaryPanelTabStrip";
import type { SecondaryPanelTabReorderHandler } from "./secondaryPanelFileTab";
import {
  TAB_PILL_AFFORDANCE_ICON_CLASS,
  TAB_PILL_CLOSE_BUTTON_CLASS,
} from "@/components/ui/tab-pill";
import { Icon } from "@/components/ui/icon";

const noop = () => {};
const noopReorder: SecondaryPanelTabReorderHandler = () => {};

type TestSecondaryPanelTabStripProps = Omit<
  ComponentProps<typeof BaseSecondaryPanelTabStrip>,
  "onReorderTab"
>;

function SecondaryPanelTabStrip(props: TestSecondaryPanelTabStripProps) {
  return <BaseSecondaryPanelTabStrip {...props} onReorderTab={noopReorder} />;
}

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
    leadingVisual: <Icon name="Code" className="size-3.5" aria-hidden />,
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
  it("renders a leading icon and swaps it for close while hovered, focused, or on mobile touch", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[buildTab({ id: "a", filename: "a.ts", isActive: true })]}
        usesDesktopChrome={false}
      />,
    );

    const closeButton = screen.getByRole("button", { name: "Close a.ts" });
    const leadingIcon = document.querySelector('[data-icon="Code"]');

    expect(leadingIcon).not.toBeNull();
    expect(leadingIcon?.parentElement?.className).toContain(
      "group-hover/tab-pill:opacity-0",
    );
    expect(leadingIcon?.parentElement?.className).toContain(
      "group-has-[[data-tab-pill-close]:focus-visible]/tab-pill:opacity-0",
    );
    expect(leadingIcon?.parentElement?.className).toContain(
      "max-md:pointer-coarse:opacity-0",
    );
    expect(closeButton.parentElement?.className).toContain("group/tab-pill");
    expect(closeButton.hasAttribute("data-tab-pill-close")).toBe(true);
    expect(closeButton.className).toContain(TAB_PILL_CLOSE_BUTTON_CLASS);
    expect(closeButton.className).toContain("opacity-0");
    expect(closeButton.className).toContain("pointer-events-none");
    expect(closeButton.className).toContain(
      "group-hover/tab-pill:pointer-events-auto",
    );
    expect(closeButton.className).toContain("group-hover/tab-pill:opacity-100");
    expect(closeButton.className).toContain("focus-visible:opacity-100");
    expect(closeButton.className).toContain(
      "max-md:pointer-coarse:pointer-events-auto",
    );
    expect(closeButton.className).toContain(
      "max-md:pointer-coarse:opacity-100",
    );
    expect(closeButton.className).toContain("max-md:pointer-coarse:size-5");
    expect(closeButton.className).not.toContain("opacity-70");
    expect(
      closeButton.querySelector("[data-icon='X']")?.getAttribute("class"),
    ).toContain(TAB_PILL_AFFORDANCE_ICON_CLASS);
  });

  it("keeps the leading icon visible for non-closable pinned tabs", () => {
    render(
      <SecondaryPanelTabStrip
        fileTabs={[
          {
            ...buildTab({ id: "a", filename: "a.ts", isActive: true }),
            isPinned: true,
          },
        ]}
        usesDesktopChrome={false}
      />,
    );

    const leadingIcon = document.querySelector('[data-icon="Code"]');

    expect(screen.queryByRole("button", { name: "Close a.ts" })).toBeNull();
    expect(leadingIcon).not.toBeNull();
    expect(leadingIcon?.parentElement?.className).not.toContain(
      "group-hover/tab-pill:opacity-0",
    );
  });

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

  it("gives both chevrons opaque fills so tabs don't bleed through", () => {
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

    const leftChevron = screen.getByRole("button", {
      name: "Scroll tabs left",
    });
    const rightChevron = screen.getByRole("button", {
      name: "Scroll tabs right",
    });

    for (const chevron of [leftChevron, rightChevron]) {
      // The chevrons overlap the edge tabs, so both resting and hover/focus
      // states must paint opaque surfaces rather than translucent state fills.
      expect(chevron.classList.contains("bg-background")).toBe(true);
      expect(chevron.classList.contains("hover:bg-muted")).toBe(true);
      expect(chevron.classList.contains("focus-visible:bg-muted")).toBe(true);
      expect(chevron.classList.contains("rounded-md")).toBe(true);
      expect(chevron.classList.contains("rounded-none")).toBe(false);
      expect(chevron.classList.contains("hover:bg-state-active")).toBe(false);
    }
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
