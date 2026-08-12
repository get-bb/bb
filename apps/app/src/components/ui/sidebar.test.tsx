// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useOptionalIsSidebarShowing,
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

describe("Sidebar", () => {
  it("keeps regular viewport content inside the safe area", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarProvider>
          <Sidebar>Sidebar content</Sidebar>
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    const sidebar = screen
      .getByText("Sidebar content")
      .closest('[data-sidebar="sidebar"]');

    expect(sidebar?.className).toContain("pt-[env(safe-area-inset-top)]");
  });
});

function getMobilePanel(): HTMLElement | null {
  const panel = document.querySelector('[data-sidebar="panel"]');
  return panel instanceof HTMLElement ? panel : null;
}

describe("mobile sidebar persistence", () => {
  it("keeps closed drawer content mounted, inert, and offscreen", () => {
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
    const row = screen.getByRole("button", { name: "Sidebar row" });
    const insetAction = screen.getByRole("button", { name: "Inset action" });

    fireEvent.click(trigger);
    settleMobileToggle();
    expect(getMobilePanel()?.dataset.state).toBe("open");

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

describe("mobile sidebar text-selection arbitration", () => {
  it("opens from a right swipe that starts over selectable message prose", () => {
    renderSelectableSwipeHarness();
    const prose = screen.getByText("Selectable message prose");

    fireTouch(prose, "touchstart", createTouch(120, 160));
    fireTouch(window, "touchmove", createTouch(260, 164));

    expect(getMobilePanel()?.dataset.state).toBe("open");
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
