// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});

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
  it("keeps closed drawer content mounted but inert and hidden from input", () => {
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

    const inset = document.querySelector('[data-sidebar="inset"]');
    expect(inset?.hasAttribute("inert")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    const openPanel = getMobilePanel();
    expect(openPanel?.dataset.state).toBe("open");
    expect(openPanel?.hasAttribute("inert")).toBe(false);

    // The open drawer is modal: every sibling of the panel goes inert so
    // Tab cannot reach outside controls, while the backdrop stays live for
    // dismissal.
    const panelParent = openPanel?.parentElement;
    const backdrop = screen.getByTestId("sidebar-mobile-backdrop");
    for (const sibling of panelParent?.children ?? []) {
      if (sibling === openPanel || sibling === backdrop) {
        expect(sibling.hasAttribute("inert")).toBe(false);
      } else {
        expect(sibling.hasAttribute("inert")).toBe(true);
      }
    }
    expect(inset?.hasAttribute("inert")).toBe(true);

    fireEvent.click(backdrop);

    const reclosedPanel = getMobilePanel();
    expect(reclosedPanel?.dataset.state).toBe("closed");
    expect(reclosedPanel?.hasAttribute("inert")).toBe(true);
    expect(reclosedPanel?.textContent).toContain("Sidebar content");
    expect(inset?.hasAttribute("inert")).toBe(false);
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
