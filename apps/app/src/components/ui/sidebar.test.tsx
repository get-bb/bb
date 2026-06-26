// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "./hooks/use-compact-viewport";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useOptionalIsSidebarShowing,
} from "./sidebar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function OptionalSidebarProbe() {
  const isShowing = useOptionalIsSidebarShowing();
  return <div data-sidebar-showing={String(isShowing)} />;
}

function renderSidebarHarness({
  isCompactViewport = true,
  withTrigger = false,
  withInteractiveContent = false,
  withTextInput = false,
  withHorizontalScroller = false,
}: {
  isCompactViewport?: boolean;
  withTrigger?: boolean;
  withInteractiveContent?: boolean;
  withTextInput?: boolean;
  withHorizontalScroller?: boolean;
} = {}) {
  render(
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <SidebarProvider>
        <Sidebar>
          <div>Sidebar content</div>
        </Sidebar>
        {withTrigger ? <SidebarTrigger /> : null}
        <SidebarInset data-testid="sidebar-inset">
          {withTextInput ? (
            <input aria-label="Main input" />
          ) : withHorizontalScroller ? (
            <div data-testid="horizontal-scroller" style={{ overflowX: "auto" }}>
              <div style={{ width: 640 }}>Wide content</div>
            </div>
          ) : withInteractiveContent ? (
            <button type="button">Main action</button>
          ) : (
            <div>Main content</div>
          )}
        </SidebarInset>
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
}

function getSidebarPanel(): HTMLElement {
  const panel = querySidebarPanel();
  if (panel === null) {
    throw new Error("Expected the sidebar panel to render.");
  }
  return panel;
}

function querySidebarPanel(): HTMLElement | null {
  const panel = document.querySelector('[data-sidebar="panel"]');
  if (!(panel instanceof HTMLElement)) {
    return null;
  }
  return panel;
}

function createTouch({
  identifier = 1,
  clientX,
  clientY,
}: {
  identifier?: number;
  clientX: number;
  clientY: number;
}): Touch {
  return { identifier, clientX, clientY } as Touch;
}

function createTouchList(...touches: Touch[]): TouchList {
  const touchList = {
    length: touches.length,
    item: (index: number) => touches[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* touches;
    },
  };
  touches.forEach((touch, index) => {
    Object.defineProperty(touchList, index, {
      configurable: true,
      enumerable: true,
      value: touch,
    });
  });
  return touchList as unknown as TouchList;
}

type FireEventTarget = Element | Document | Window;

function fireTouchEvent(
  target: FireEventTarget,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  {
    touches = createTouchList(),
    changedTouches = createTouchList(),
  }: {
    touches?: TouchList;
    changedTouches?: TouchList;
  },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { configurable: true, value: touches },
    changedTouches: { configurable: true, value: changedTouches },
  });
  fireEvent(target, event);
}

function fireTouchStart(
  target: FireEventTarget,
  init: Parameters<typeof fireTouchEvent>[2],
) {
  fireTouchEvent(target, "touchstart", init);
}

function fireTouchMove(
  target: FireEventTarget,
  init: Parameters<typeof fireTouchEvent>[2],
) {
  fireTouchEvent(target, "touchmove", init);
}

function fireTouchEnd(
  target: FireEventTarget,
  init: Parameters<typeof fireTouchEvent>[2],
) {
  fireTouchEvent(target, "touchend", init);
}

function makeElementHorizontallyScrollable(element: HTMLElement) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 320 },
    scrollWidth: { configurable: true, value: 640 },
  });
}

describe("useOptionalIsSidebarShowing", () => {
  it("returns null outside SidebarProvider instead of throwing", () => {
    expect(renderToString(<OptionalSidebarProbe />)).toContain(
      'data-sidebar-showing="null"',
    );
  });
});

describe("mobile sidebar drawer", () => {
  it("opens through the trigger using the mobile drawer path", () => {
    renderSidebarHarness({ withTrigger: true });

    expect(querySidebarPanel()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    const panel = getSidebarPanel();
    expect(panel.getAttribute("data-vaul-drawer-direction")).toBe("left");
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(panel.getAttribute("data-vaul-animate")).not.toBe("false");
    expect(panel.className).toContain("z-40");
    expect(panel.textContent).toContain("Sidebar content");
    const backdrop = screen.queryByTestId("sidebar-mobile-backdrop");
    expect(backdrop?.className).toContain("z-40");
    expect(backdrop?.className).toContain("data-[state=closed]:pointer-events-none");
    expect(backdrop?.style.opacity).toBe("");
  });

  it("opens when swiping right from the main content", () => {
    renderSidebarHarness();
    const content = screen.getByText("Main content");

    fireTouchStart(content, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 310, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });

    const panel = getSidebarPanel();
    expect(panel.textContent).toContain("Sidebar content");
    expect(panel.style.transform).toContain("translate3d(-");
    expect(panel.style.transition).toBe("none");
    expect(panel.getAttribute("data-vaul-animate")).toBe("false");
    expect(screen.queryByTestId("sidebar-mobile-backdrop")).not.toBeNull();

    fireTouchEnd(window, {
      touches: createTouchList(),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });

    expect(panel.style.transform).toBe("translate3d(-0%, 0, 0)");
    expect(panel.style.transition).toBe("");
  });

  it("commits open after dragging about a third of the sidebar width", () => {
    renderSidebarHarness();
    const content = screen.getByText("Main content");

    fireTouchStart(content, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 270, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 270, clientY: 124 }),
      ),
    });
    fireTouchEnd(window, {
      touches: createTouchList(),
      changedTouches: createTouchList(
        createTouch({ clientX: 270, clientY: 124 }),
      ),
    });

    const panel = getSidebarPanel();
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(panel.style.transform).toBe("translate3d(-0%, 0, 0)");
  });

  it("commits open after a short fast rightward fling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    renderSidebarHarness();
    const content = screen.getByText("Main content");

    fireTouchStart(content, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });

    act(() => {
      vi.advanceTimersByTime(50);
    });

    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 210, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 210, clientY: 124 }),
      ),
    });
    fireTouchEnd(window, {
      touches: createTouchList(),
      changedTouches: createTouchList(
        createTouch({ clientX: 210, clientY: 124 }),
      ),
    });

    const panel = getSidebarPanel();
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(panel.style.transform).toBe("translate3d(-0%, 0, 0)");
  });

  it("snaps closed after a tiny fast twitch", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    renderSidebarHarness();
    const content = screen.getByText("Main content");

    fireTouchStart(content, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });

    act(() => {
      vi.advanceTimersByTime(20);
    });

    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 190, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 190, clientY: 124 }),
      ),
    });
    fireTouchEnd(window, {
      touches: createTouchList(),
      changedTouches: createTouchList(
        createTouch({ clientX: 190, clientY: 124 }),
      ),
    });

    const panel = getSidebarPanel();
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(panel.style.transform).toBe("translate3d(-100%, 0, 0)");
  });

  it("snaps closed after a short drag", () => {
    vi.useFakeTimers();
    renderSidebarHarness();
    const content = screen.getByText("Main content");

    fireTouchStart(content, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 236, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 236, clientY: 124 }),
      ),
    });

    const panel = getSidebarPanel();
    expect(panel.style.transform).toContain("translate3d(-");

    fireTouchEnd(window, {
      touches: createTouchList(),
      changedTouches: createTouchList(
        createTouch({ clientX: 236, clientY: 124 }),
      ),
    });

    expect(panel.style.transform).toBe("translate3d(-100%, 0, 0)");

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(panel.getAttribute("data-state")).toBe("closed");
    expect(panel.getAttribute("data-vaul-animate")).not.toBe("false");
    expect(panel.style.transform).toBe("translate3d(-100%, 0, 0)");
    const backdrop = screen.queryByTestId("sidebar-mobile-backdrop");
    expect(backdrop?.getAttribute("data-state")).toBe("closed");
    expect(backdrop?.getAttribute("data-vaul-animate")).not.toBe("false");
    expect(backdrop?.style.opacity).toBe("0");
    expect(backdrop?.style.pointerEvents).toBe("none");

    act(() => {
      vi.advanceTimersByTime(500);
    });
  });

  it("uses the normal open animation after a canceled drag", () => {
    vi.useFakeTimers();
    renderSidebarHarness({ withTrigger: true });
    const content = screen.getByText("Main content");

    fireTouchStart(content, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 236, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 236, clientY: 124 }),
      ),
    });
    fireTouchEnd(window, {
      touches: createTouchList(),
      changedTouches: createTouchList(
        createTouch({ clientX: 236, clientY: 124 }),
      ),
    });

    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(
      screen
        .queryByTestId("sidebar-mobile-backdrop")
        ?.getAttribute("data-vaul-animate"),
    ).not.toBe("false");

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const trigger = document.querySelector('[data-sidebar="trigger"]');
    expect(trigger).toBeInstanceOf(HTMLElement);
    fireEvent.click(trigger as HTMLElement);

    const panel = getSidebarPanel();
    const backdrop = screen.queryByTestId("sidebar-mobile-backdrop");
    expect(panel.getAttribute("data-vaul-animate")).not.toBe("false");
    expect(panel.style.transform).toBe("");
    expect(backdrop?.getAttribute("data-vaul-animate")).not.toBe("false");
    expect(backdrop?.style.opacity).toBe("");
  });

  it("suppresses only the open replay after a drag-open settles", () => {
    vi.useFakeTimers();
    renderSidebarHarness();
    const content = screen.getByText("Main content");

    fireTouchStart(content, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 310, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });
    fireTouchEnd(window, {
      touches: createTouchList(),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });

    act(() => {
      vi.advanceTimersByTime(220);
    });

    const panel = getSidebarPanel();
    const backdrop = screen.getByTestId("sidebar-mobile-backdrop");
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(panel.getAttribute("data-vaul-animate")).not.toBe("false");
    expect(panel.getAttribute("data-sidebar-suppress-open-animation")).toBe(
      "true",
    );
    expect(backdrop.getAttribute("data-vaul-animate")).not.toBe("false");
    expect(
      backdrop.getAttribute("data-sidebar-suppress-open-animation"),
    ).toBe("true");
    expect(panel.style.transform).toBe("");
  });

  it("keeps the Vaul close animation enabled after a drag-open", () => {
    vi.useFakeTimers();
    renderSidebarHarness({ withTrigger: true });
    const content = screen.getByText("Main content");

    fireTouchStart(content, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 310, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });
    fireTouchEnd(window, {
      touches: createTouchList(),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });

    act(() => {
      vi.advanceTimersByTime(400);
    });

    const trigger = document.querySelector('[data-sidebar="trigger"]');
    expect(trigger).toBeInstanceOf(HTMLElement);
    fireEvent.click(trigger as HTMLElement);

    const panel = getSidebarPanel();
    const backdrop = screen.queryByTestId("sidebar-mobile-backdrop");
    expect(panel.getAttribute("data-state")).toBe("closed");
    expect(panel.getAttribute("data-vaul-animate")).not.toBe("false");
    expect(backdrop?.getAttribute("data-state")).toBe("closed");
    expect(backdrop?.getAttribute("data-vaul-animate")).not.toBe("false");
  });

  it("can reopen from a swipe that starts on the closing backdrop", () => {
    renderSidebarHarness({ withTrigger: true });
    const trigger = document.querySelector('[data-sidebar="trigger"]');
    expect(trigger).toBeInstanceOf(HTMLElement);

    fireEvent.click(trigger as HTMLElement);
    fireEvent.click(trigger as HTMLElement);

    const backdrop = screen.getByTestId("sidebar-mobile-backdrop");
    expect(backdrop.getAttribute("data-state")).toBe("closed");

    fireTouchStart(backdrop, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 310, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });

    const panel = getSidebarPanel();
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(panel.style.transform).toContain("translate3d(-");
    expect(panel.getAttribute("data-vaul-animate")).toBe("false");
  });

  it("can reopen from a swipe that targets the document root while closing", () => {
    renderSidebarHarness({ withTrigger: true });
    const trigger = document.querySelector('[data-sidebar="trigger"]');
    expect(trigger).toBeInstanceOf(HTMLElement);

    fireEvent.click(trigger as HTMLElement);
    fireEvent.click(trigger as HTMLElement);

    const closingPanel = getSidebarPanel();
    expect(closingPanel.getAttribute("data-state")).toBe("closed");

    fireTouchStart(document.documentElement, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 310, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });

    const panel = getSidebarPanel();
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(panel.style.transform).toContain("translate3d(-");
    expect(panel.getAttribute("data-vaul-animate")).toBe("false");
  });

  it("can reopen from a pointer swipe that targets the document root while closing", () => {
    renderSidebarHarness({ withTrigger: true });
    const trigger = document.querySelector('[data-sidebar="trigger"]');
    expect(trigger).toBeInstanceOf(HTMLElement);

    fireEvent.click(trigger as HTMLElement);
    fireEvent.click(trigger as HTMLElement);

    const closingPanel = getSidebarPanel();
    expect(closingPanel.getAttribute("data-state")).toBe("closed");

    fireEvent.pointerDown(document.documentElement, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 160,
      clientY: 120,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 310,
      clientY: 124,
    });

    const panel = getSidebarPanel();
    expect(panel.getAttribute("data-state")).toBe("open");
    expect(panel.style.transform).toContain("translate3d(-");
    expect(panel.getAttribute("data-vaul-animate")).toBe("false");
  });

  it("does not reopen from the document root without a closing sidebar", () => {
    renderSidebarHarness();

    fireTouchStart(document.body, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 310, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });

    expect(querySidebarPanel()).toBeNull();
    expect(screen.queryByTestId("sidebar-mobile-backdrop")).toBeNull();
  });

  it("does not fight the browser back edge gesture", () => {
    renderSidebarHarness();
    const content = screen.getByText("Main content");

    fireTouchStart(content, {
      touches: createTouchList(createTouch({ clientX: 10, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 10, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 140, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 140, clientY: 124 }),
      ),
    });

    expect(querySidebarPanel()).toBeNull();
    expect(screen.queryByTestId("sidebar-mobile-backdrop")).toBeNull();
  });

  it("drags when touch events follow an initial pointer event", () => {
    renderSidebarHarness();
    const inset = screen.getByTestId("sidebar-inset");

    fireEvent.pointerDown(inset, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 160,
      clientY: 120,
    });
    fireTouchStart(inset, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 236, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 236, clientY: 124 }),
      ),
    });

    expect(getSidebarPanel().textContent).toContain("Sidebar content");
  });

  it("drags from native pointer movement on nested main content", () => {
    renderSidebarHarness();
    const content = screen.getByText("Main content");

    fireEvent.pointerDown(content, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 160,
      clientY: 120,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 236,
      clientY: 124,
    });

    expect(getSidebarPanel().textContent).toContain("Sidebar content");
  });

  it("opens from a horizontal wheel swipe in compact viewports", () => {
    renderSidebarHarness();
    const content = screen.getByText("Main content");

    fireEvent.wheel(content, {
      deltaX: 96,
      deltaY: 2,
      clientX: 160,
      clientY: 120,
    });

    expect(getSidebarPanel().textContent).toContain("Sidebar content");
  });

  it("does not install the wheel swipe listener on wide viewports", () => {
    const addEventListener = vi.spyOn(document, "addEventListener");

    renderSidebarHarness({ isCompactViewport: false });

    expect(
      addEventListener.mock.calls.filter(([eventName]) => eventName === "wheel"),
    ).toHaveLength(0);
  });

  it("ignores rightward gestures inside horizontally scrollable content", () => {
    renderSidebarHarness({ withHorizontalScroller: true });
    const scroller = screen.getByTestId("horizontal-scroller");
    makeElementHorizontallyScrollable(scroller);
    const wideContent = screen.getByText("Wide content");

    fireTouchStart(wideContent, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 310, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 310, clientY: 124 }),
      ),
    });
    fireEvent.wheel(wideContent, {
      deltaX: 96,
      deltaY: 2,
      clientX: 160,
      clientY: 120,
    });

    expect(querySidebarPanel()).toBeNull();
    expect(screen.queryByTestId("sidebar-mobile-backdrop")).toBeNull();
  });

  it("ignores vertical touch gestures on the main content", () => {
    renderSidebarHarness();
    const inset = screen.getByTestId("sidebar-inset");

    fireTouchStart(inset, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 166, clientY: 170 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 166, clientY: 170 }),
      ),
    });
    fireTouchEnd(window, {
      touches: createTouchList(),
      changedTouches: createTouchList(
        createTouch({ clientX: 166, clientY: 170 }),
      ),
    });

    expect(querySidebarPanel()).toBeNull();
    expect(screen.queryByTestId("sidebar-mobile-backdrop")).toBeNull();
  });

  it("opens from button-like main content", () => {
    renderSidebarHarness({ withInteractiveContent: true });

    fireTouchStart(screen.getByRole("button", { name: "Main action" }), {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 260, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 260, clientY: 124 }),
      ),
    });

    expect(getSidebarPanel().textContent).toContain("Sidebar content");
  });

  it("ignores swipe gestures that start on text inputs", () => {
    renderSidebarHarness({ withTextInput: true });

    fireTouchStart(screen.getByRole("textbox", { name: "Main input" }), {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 260, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 260, clientY: 124 }),
      ),
    });

    expect(querySidebarPanel()).toBeNull();
    expect(screen.queryByTestId("sidebar-mobile-backdrop")).toBeNull();
  });

  it("does not start a mobile swipe on wide viewports", () => {
    renderSidebarHarness({ isCompactViewport: false });
    const inset = screen.getByTestId("sidebar-inset");

    fireTouchStart(inset, {
      touches: createTouchList(createTouch({ clientX: 160, clientY: 120 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 160, clientY: 120 }),
      ),
    });
    fireTouchMove(window, {
      touches: createTouchList(createTouch({ clientX: 260, clientY: 124 })),
      changedTouches: createTouchList(
        createTouch({ clientX: 260, clientY: 124 }),
      ),
    });

    expect(screen.queryByTestId("sidebar-mobile-backdrop")).toBeNull();
    expect(getSidebarPanel().getAttribute("data-vaul-drawer-direction")).toBe(
      null,
    );
  });
});
