// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { memo } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useIsSidebarShowing,
  useOptionalIsSidebarShowing,
  useSidebar,
} from "./sidebar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Matches SIDEBAR_MOBILE_DRAG_SETTLE_MS: the deferred mobile open and close
// flip React state only after the slide transition window has elapsed.
const MOBILE_TOGGLE_SETTLE_MS = 220;

function settleMobileToggle() {
  act(() => {
    vi.advanceTimersByTime(MOBILE_TOGGLE_SETTLE_MS);
  });
}

function createTouch(clientX: number, clientY: number): Touch {
  return { identifier: 1, clientX, clientY } as Touch;
}

function createTouchList(...touches: Touch[]): TouchList {
  const touchList = {
    length: touches.length,
    item: (index: number) => touches[index] ?? null,
  };
  touches.forEach((touch, index) => {
    Object.defineProperty(touchList, index, { value: touch });
  });
  return touchList as unknown as TouchList;
}

function fireTouch(
  target: Element | Document | Window,
  type: "touchstart" | "touchmove",
  touch: Touch,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: createTouchList(touch) },
    changedTouches: { value: createTouchList(touch) },
  });
  fireEvent(target, event);
}

function firePointer(
  target: Element | Document | Window,
  type: "pointerdown" | "pointermove",
  clientX: number,
  clientY: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
    isPrimary: { value: true },
    button: { value: 0 },
    buttons: { value: 1 },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
}

function renderScrollerSwipeHarness() {
  render(
    <CompactViewportOverrideProvider isCompactViewport>
      <SidebarProvider>
        <Sidebar>Sidebar content</Sidebar>
        <SidebarInset>
          <div data-testid="scroller" style={{ overflowX: "auto" }}>
            <div data-sidebar-swipe-selectable>Wide code block</div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
  const scroller = screen.getByTestId("scroller");
  let scrollWidthReads = 0;
  Object.defineProperty(scroller, "scrollWidth", {
    get: () => {
      scrollWidthReads += 1;
      return 500;
    },
  });
  Object.defineProperty(scroller, "clientWidth", { get: () => 100 });
  return {
    prose: screen.getByText("Wide code block"),
    getScrollWidthReads: () => scrollWidthReads,
  };
}

function renderSelectableSwipeHarness() {
  render(
    <CompactViewportOverrideProvider isCompactViewport>
      <SidebarProvider>
        <Sidebar>Sidebar content</Sidebar>
        <SidebarInset>
          <div data-sidebar-swipe-selectable>Selectable message prose</div>
        </SidebarInset>
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
}

function OptionalSidebarProbe() {
  const isShowing = useOptionalIsSidebarShowing();
  return <div data-sidebar-showing={String(isShowing)} />;
}

describe("useOptionalIsSidebarShowing", () => {
  it("returns null outside SidebarProvider instead of throwing", () => {
    expect(renderToString(<OptionalSidebarProbe />)).toContain(
      'data-sidebar-showing="null"',
    );
  });
});

describe("useIsSidebarShowing", () => {
  it("re-renders its reader only when the visible bit flips, not on every provider commit", () => {
    vi.useFakeTimers();
    const showingRenders: boolean[] = [];
    const ShowingReader = memo(function ShowingReader() {
      const isShowing = useIsSidebarShowing();
      showingRenders.push(isShowing);
      return <output data-testid="showing">{String(isShowing)}</output>;
    });
    function Controls() {
      const {
        openMobileSidebar,
        closeMobileSidebar,
        setSuppressMobileOpenAnimation,
      } = useSidebar();
      return (
        <>
          <button type="button" onClick={openMobileSidebar}>
            open
          </button>
          <button type="button" onClick={closeMobileSidebar}>
            close
          </button>
          <button
            type="button"
            onClick={() => setSuppressMobileOpenAnimation(true)}
          >
            suppress
          </button>
        </>
      );
    }
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <ShowingReader />
          <Controls />
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );
    expect(screen.getByTestId("showing").textContent).toBe("false");
    const settled = showingRenders.length;

    // A provider commit that changes the full context object but not the
    // visible bit (page header and retained secondary panel read only the bit).
    fireEvent.click(screen.getByRole("button", { name: "suppress" }));
    expect(showingRenders).toHaveLength(settled);

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    settleMobileToggle();
    expect(screen.getByTestId("showing").textContent).toBe("true");
    const afterOpen = showingRenders.length;
    expect(afterOpen).toBe(settled + 1);

    // Close: the closing-flag commit must not reach the reader; only the
    // deferred openMobile flip does.
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(showingRenders).toHaveLength(afterOpen);
    settleMobileToggle();
    expect(screen.getByTestId("showing").textContent).toBe("false");
    expect(showingRenders).toHaveLength(afterOpen + 1);
  });
});

describe("SidebarTrigger", () => {
  it("uses the shared sidebar icon on every viewport", () => {
    const markup = renderToString(
      <SidebarProvider>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    expect(markup).toContain('data-icon="PanelLeft"');
    expect(markup).not.toContain('data-icon="AlignLeft"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).not.toContain('aria-pressed="');
  });
});

function getMobilePanel(): HTMLElement | null {
  const panel = document.querySelector('[data-sidebar="panel"]');
  return panel instanceof HTMLElement ? panel : null;
}

// Matches SIDEBAR_MOBILE_REALIZE_TIMEOUT_MS: the closed compact drawer
// realizes its subtree at the latest this long after boot.
const MOBILE_REALIZE_TIMEOUT_MS = 1000;

function settleMobileRealization() {
  act(() => {
    vi.advanceTimersByTime(MOBILE_REALIZE_TIMEOUT_MS);
  });
}

function renderCompactSidebarHarness() {
  render(
    <CompactViewportOverrideProvider isCompactViewport>
      <SidebarProvider>
        <Sidebar>Sidebar content</Sidebar>
        <SidebarInset>
          <SidebarTrigger />
          Main content
        </SidebarInset>
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
}

describe("mobile sidebar deferred realization", () => {
  it("mounts the closed panel empty at boot and realizes it after the settle window", () => {
    vi.useFakeTimers();
    renderCompactSidebarHarness();

    // The panel element itself is mounted from the first commit (the swipe
    // helpers select it), but its subtree stays out of the boot critical
    // path while the drawer is closed.
    const closedPanel = getMobilePanel();
    expect(closedPanel).not.toBeNull();
    expect(closedPanel?.dataset.state).toBe("closed");
    expect(closedPanel?.hasAttribute("inert")).toBe(true);
    expect(closedPanel?.textContent).not.toContain("Sidebar content");

    settleMobileRealization();

    // Same panel element; only the subtree was realized (no remount).
    expect(getMobilePanel()).toBe(closedPanel);
    expect(closedPanel?.dataset.state).toBe("closed");
    expect(closedPanel?.textContent).toContain("Sidebar content");
  });

  it("prefers requestIdleCallback with a bounded timeout when available", () => {
    vi.useFakeTimers();
    let idleCallback: (() => void) | null = null;
    let idleTimeout: number | undefined;
    const cancelIdle = vi.fn();
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: (callback: () => void, options?: { timeout?: number }) => {
        idleCallback = callback;
        idleTimeout = options?.timeout;
        return 1;
      },
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: cancelIdle,
    });
    try {
      renderCompactSidebarHarness();
      expect(idleCallback).not.toBeNull();
      expect(idleTimeout).toBe(MOBILE_REALIZE_TIMEOUT_MS);
      expect(getMobilePanel()?.textContent).not.toContain("Sidebar content");

      // Frames alone must not realize: idle is the signal in this browser.
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(getMobilePanel()?.textContent).not.toContain("Sidebar content");

      act(() => {
        idleCallback?.();
      });
      expect(getMobilePanel()?.textContent).toContain("Sidebar content");
    } finally {
      Reflect.deleteProperty(window, "requestIdleCallback");
      Reflect.deleteProperty(window, "cancelIdleCallback");
    }
  });

  it("realizes the subtree at the start of a deferred open before idle", () => {
    vi.useFakeTimers();
    renderCompactSidebarHarness();
    expect(getMobilePanel()?.textContent).not.toContain("Sidebar content");

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    // The slide starts from inline styles while React state stays closed;
    // the subtree must commit during that window, not after the settle.
    const openingPanel = getMobilePanel();
    expect(openingPanel?.dataset.state).toBe("closed");
    expect(openingPanel?.textContent).toContain("Sidebar content");

    settleMobileToggle();
    expect(getMobilePanel()?.dataset.state).toBe("open");
    expect(getMobilePanel()?.textContent).toContain("Sidebar content");

    // Retained across close: the latch never resets.
    fireEvent.click(screen.getByTestId("sidebar-mobile-backdrop"));
    settleMobileToggle();
    expect(getMobilePanel()?.dataset.state).toBe("closed");
    expect(getMobilePanel()?.textContent).toContain("Sidebar content");
  });

  it("renders the desktop sidebar subtree synchronously", () => {
    const markup = renderToString(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarProvider>
          <Sidebar>Sidebar content</Sidebar>
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    expect(markup).toContain("Sidebar content");
  });
});

describe("mobile sidebar persistence", () => {
  it("keeps closed drawer content mounted, inert, and offscreen", () => {
    vi.useFakeTimers();
    renderCompactSidebarHarness();
    settleMobileRealization();

    // The rows stay mounted while the drawer is closed, so reopening
    // replays no mount cost (#1261) — but the closed panel must not be
    // reachable by taps or focus.
    const closedPanel = getMobilePanel();
    expect(closedPanel).not.toBeNull();
    expect(closedPanel?.textContent).toContain("Sidebar content");
    expect(closedPanel?.dataset.state).toBe("closed");
    expect(closedPanel?.hasAttribute("inert")).toBe(true);
    expect(closedPanel?.className).not.toContain("invisible");

    const inset = document.querySelector('[data-sidebar="inset"]');
    expect(inset?.hasAttribute("inert")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    // The open is also deferred: the slide-in starts from inline styles
    // while React state stays closed, then the commit lands after settle.
    const openingPanel = getMobilePanel();
    expect(openingPanel?.dataset.state).toBe("closed");
    // jsdom normalizes the "-0%" the helper writes to "0%".
    expect(openingPanel?.style.translate).toBe("0%");
    settleMobileToggle();

    const openPanel = getMobilePanel();
    expect(openPanel?.dataset.state).toBe("open");
    expect(openPanel?.hasAttribute("inert")).toBe(false);

    // The open drawer is modal WITHOUT marking siblings inert: an `inert`
    // flip on the content inset forces a style re-resolution of that whole
    // subtree (~hundreds of ms on a long timeline in WebKit). The backdrop
    // blocks pointer input and the keydown trap owns Tab instead.
    const panelParent = openPanel?.parentElement;
    const backdrop = screen.getByTestId("sidebar-mobile-backdrop");
    for (const sibling of panelParent?.children ?? []) {
      expect(sibling.hasAttribute("inert")).toBe(false);
    }
    expect(inset?.hasAttribute("inert")).toBe(false);

    // Backdrop dismissal starts the slide-out immediately (inline settle
    // styles) and flips React state only after the settle window, so the
    // exit animation never waits on the close commit's style recalc.
    fireEvent.click(backdrop);
    const closingPanel = getMobilePanel();
    expect(closingPanel?.dataset.state).toBe("open");
    expect(closingPanel?.style.translate).toBe("-100%");

    settleMobileToggle();

    const reclosedPanel = getMobilePanel();
    expect(reclosedPanel?.dataset.state).toBe("closed");
    expect(reclosedPanel?.hasAttribute("inert")).toBe(true);
    expect(reclosedPanel?.textContent).toContain("Sidebar content");
    expect(inset?.hasAttribute("inert")).toBe(false);
  });

  it("blocks tap-through with the backdrop during the deferred open", () => {
    vi.useFakeTimers();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <Sidebar>Sidebar content</Sidebar>
          <SidebarInset>
            <SidebarTrigger />
            Main content
          </SidebarInset>
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    // React state stays closed for the settle window, so the class-driven
    // backdrop state still reads pointer-events-none while the panel is
    // still `inert`. The inline override must intercept taps immediately,
    // or a rapid second tap falls through onto the page below.
    const backdrop = screen.getByTestId("sidebar-mobile-backdrop");
    expect(getMobilePanel()?.dataset.state).toBe("closed");
    expect(backdrop.style.pointerEvents).toBe("auto");

    // A tap the backdrop absorbs mid-slide must not cancel the open; the
    // settle guard swallows the dismiss.
    fireEvent.click(backdrop);
    settleMobileToggle();
    expect(getMobilePanel()?.dataset.state).toBe("open");
    // The commit clears the override; the open-state class owns taps now.
    expect(backdrop.style.pointerEvents).toBe("");

    fireEvent.click(backdrop);
    settleMobileToggle();
    expect(getMobilePanel()?.dataset.state).toBe("closed");
    // No stale override may keep the closed backdrop interactive.
    expect(backdrop.style.pointerEvents).not.toBe("auto");
  });

  it("keeps the pinned trigger interactive and closes on a second press", () => {
    vi.useFakeTimers();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <Sidebar>Sidebar content</Sidebar>
          <SidebarInset>Main content</SidebarInset>
          {/* Mirrors AppLayout's SidebarTriggerOverlay: a sibling of the
              panel, pinned above it. */}
          <div data-testid="trigger-overlay">
            <SidebarTrigger />
          </div>
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    const overlay = screen.getByTestId("trigger-overlay");

    fireEvent.click(trigger);
    settleMobileToggle();
    expect(getMobilePanel()?.dataset.state).toBe("open");
    // The overlay must stay interactive while the drawer is open so a
    // second press can close it.
    expect(overlay.hasAttribute("inert")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(trigger);
    // The state flip defers past the slide-out; the panel is already moving.
    expect(getMobilePanel()?.dataset.state).toBe("open");
    expect(getMobilePanel()?.style.translate).toBe("-100%");

    settleMobileToggle();
    expect(getMobilePanel()?.dataset.state).toBe("closed");
    expect(getMobilePanel()?.hasAttribute("inert")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    // A third press reopens (deferred like every open).
    fireEvent.click(trigger);
    settleMobileToggle();
    expect(getMobilePanel()?.dataset.state).toBe("open");
  });

  it("traps Tab between the trigger and the open drawer", () => {
    vi.useFakeTimers();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <Sidebar>
            <button type="button">Sidebar row</button>
          </Sidebar>
          <SidebarInset>
            <button type="button">Inset action</button>
          </SidebarInset>
          <div data-testid="trigger-overlay">
            <SidebarTrigger />
          </div>
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    const insetAction = screen.getByRole("button", { name: "Inset action" });

    fireEvent.click(trigger);
    settleMobileToggle();
    expect(getMobilePanel()?.dataset.state).toBe("open");
    // The row exists only once the open realized the drawer subtree.
    const row = screen.getByRole("button", { name: "Sidebar row" });

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row, { key: "Tab" });
    expect(document.activeElement).toBe(trigger);

    fireEvent.keyDown(trigger, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(row);

    // Focus that escaped into the (non-inert) inset is recaptured by the
    // next Tab instead of walking the app behind the modal drawer.
    act(() => insetAction.focus());
    fireEvent.keyDown(insetAction, { key: "Tab" });
    expect(document.activeElement).toBe(trigger);
  });

  it("moves focus only when a focus-visible trigger opens the drawer", () => {
    vi.useFakeTimers();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <Sidebar>Sidebar content</Sidebar>
          <SidebarInset>
            <SidebarTrigger />
            Main content
          </SidebarInset>
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    const panel = getMobilePanel();
    if (!panel) throw new Error("Expected mobile sidebar panel");
    const focusSpy = vi.spyOn(panel, "focus");

    fireEvent.click(trigger);
    settleMobileToggle();
    expect(focusSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("sidebar-mobile-backdrop"));
    settleMobileToggle();
    trigger.focus();
    const matches = trigger.matches.bind(trigger);
    vi.spyOn(trigger, "matches").mockImplementation((selector) =>
      selector === '[data-sidebar="trigger"]:focus-visible'
        ? true
        : matches(selector),
    );
    fireEvent.click(trigger);
    settleMobileToggle();

    expect(focusSpy).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(panel);
  });
});

describe("mobile sidebar swipe-open touch listener scoping", () => {
  function touchMoveRegistrations(spy: {
    mock: { calls: readonly (readonly unknown[])[] };
  }) {
    return spy.mock.calls.filter(([type]) => type === "touchmove");
  }

  it("registers a passive touchmove for touches that start deep in the content", () => {
    renderSelectableSwipeHarness();
    const prose = screen.getByText("Selectable message prose");
    const addSpy = vi.spyOn(window, "addEventListener");

    // Deeper than the edge zone: this is a scroll far more often than a
    // swipe, so it must never make the browser wait on the main thread.
    fireTouch(prose, "touchstart", createTouch(120, 160));

    const registrations = touchMoveRegistrations(addSpy);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.[2]).toEqual({ passive: true });

    // The passive session still recognizes and completes the swipe.
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperties(move, {
      touches: { value: createTouchList(createTouch(260, 164)) },
      changedTouches: { value: createTouchList(createTouch(260, 164)) },
    });
    fireEvent(window, move);
    expect(getMobilePanel()?.dataset.state).toBe("open");
    // ... without calling preventDefault from the passive listener.
    expect(move.defaultPrevented).toBe(false);
  });

  it("keeps the non-passive touchmove for edge-zone touches so the swipe can claim the gesture", () => {
    renderSelectableSwipeHarness();
    const prose = screen.getByText("Selectable message prose");
    const addSpy = vi.spyOn(window, "addEventListener");

    fireTouch(prose, "touchstart", createTouch(40, 160));

    const registrations = touchMoveRegistrations(addSpy);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.[2]).toEqual({ passive: false });

    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperties(move, {
      touches: { value: createTouchList(createTouch(180, 164)) },
      changedTouches: { value: createTouchList(createTouch(180, 164)) },
    });
    fireEvent(window, move);
    expect(getMobilePanel()?.dataset.state).toBe("open");
    expect(move.defaultPrevented).toBe(true);
  });
});

describe("mobile sidebar text-selection arbitration", () => {
  it("opens from a right swipe that starts over selectable message prose", () => {
    renderSelectableSwipeHarness();
    const prose = screen.getByText("Selectable message prose");

    fireTouch(prose, "touchstart", createTouch(120, 160));
    fireTouch(window, "touchmove", createTouch(260, 164));

    expect(getMobilePanel()?.dataset.state).toBe("open");
    // The swipe path flips React state directly; the subtree must realize
    // in that same commit so the dragged-in panel is not empty.
    expect(getMobilePanel()?.textContent).toContain("Sidebar content");
  });

  it("defers the horizontal-scroll-region probe until horizontal intent", () => {
    const { prose, getScrollWidthReads } = renderScrollerSwipeHarness();

    fireTouch(prose, "touchstart", createTouch(120, 160));

    // The tap path must stay free of forced layout reads (#1269).
    expect(getScrollWidthReads()).toBe(0);

    fireTouch(window, "touchmove", createTouch(260, 164));
    fireTouch(window, "touchmove", createTouch(280, 164));

    // Exactly one probe per gesture, then the swipe cancels.
    expect(getScrollWidthReads()).toBe(1);
    expect(getMobilePanel()?.dataset.state).toBe("closed");
  });

  it("defers the probe on the pointer path as well", () => {
    const { prose, getScrollWidthReads } = renderScrollerSwipeHarness();

    firePointer(prose, "pointerdown", 120, 160);

    expect(getScrollWidthReads()).toBe(0);

    firePointer(window, "pointermove", 260, 164);
    firePointer(window, "pointermove", 280, 164);

    expect(getScrollWidthReads()).toBe(1);
    expect(getMobilePanel()?.dataset.state).toBe("closed");
  });

  it("cancels a swipe whose start target detached before the probe", () => {
    const { prose, getScrollWidthReads } = renderScrollerSwipeHarness();

    fireTouch(prose, "touchstart", createTouch(120, 160));
    prose.remove();
    fireTouch(window, "touchmove", createTouch(260, 164));

    // A detached target reports empty computed style; never probe or open.
    expect(getScrollWidthReads()).toBe(0);
    expect(getMobilePanel()?.dataset.state).toBe("closed");
  });

  it("cancels a pending prose swipe when native text selection begins", () => {
    let hasSelection = false;
    let selectionNode: Node | null = null;
    vi.spyOn(document, "getSelection").mockImplementation(() =>
      hasSelection
        ? ({
            anchorNode: selectionNode,
            focusNode: selectionNode,
            isCollapsed: false,
          } as Selection)
        : null,
    );
    renderSelectableSwipeHarness();
    const prose = screen.getByText("Selectable message prose");
    selectionNode = prose.firstChild;

    fireTouch(prose, "touchstart", createTouch(120, 160));
    hasSelection = true;
    fireEvent(document, new Event("selectionchange"));
    fireTouch(window, "touchmove", createTouch(260, 164));

    expect(getMobilePanel()?.dataset.state).toBe("closed");
  });
});
