// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mockPointerCoarse(
  matches: boolean,
  options: { reducedMotion?: boolean } = {},
) {
  const reducedMotion = options.reducedMotion ?? true;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches:
      (query === POINTER_COARSE_QUERY && matches) ||
      (reducedMotion && query.includes("prefers-reduced-motion")),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

describe("ResponsiveDrawerShell", () => {
  it("does not create portal nodes before its first open", () => {
    mockPointerCoarse(true);
    render(
      <ResponsiveDrawerShell open={false} onOpenChange={() => {}}>
        <button type="button">Project option</button>
      </ResponsiveDrawerShell>,
    );

    expect(document.querySelector("[data-bb-sheet-content]")).toBeNull();
    expect(document.querySelector("[data-bb-sheet-backdrop]")).toBeNull();
    expect(document.querySelector("[data-bb-sheet-view]")).toBeNull();
  });

  it("starts the Silk shell before it realizes content two frames later", async () => {
    mockPointerCoarse(true);
    vi.useFakeTimers();
    // Hold the realization latch on the fallback timer while Silk still gets
    // synchronous travel with skipped animations.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const appTree = document.createElement("main");
    document.body.appendChild(appTree);

    try {
      render(
        <ResponsiveDrawerShell
          open={true}
          onOpenChange={() => {}}
          srLabel="Models"
        >
          <button type="button">Choose model</button>
        </ResponsiveDrawerShell>,
      );

      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(document.querySelector("[data-bb-sheet-content]")).not.toBeNull();
      expect(
        document.querySelector("[data-bb-sheet-placeholder]"),
      ).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Choose model" })).toBeNull();
      expect(appTree.hasAttribute("inert")).toBe(false);
      expect(appTree.getAttribute("aria-hidden")).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(119);
      });
      expect(screen.queryByRole("button", { name: "Choose model" })).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole("button", { name: "Choose model" })).toBeTruthy();
    } finally {
      appTree.remove();
    }
  });

  it("retains realized content across close and reopen", async () => {
    mockPointerCoarse(true);
    const view = render(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <input aria-label="Search models" defaultValue="keep" />
      </ResponsiveDrawerShell>,
    );
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "Search models" }),
      ).toBeTruthy();
    });
    const input = screen.getByRole("textbox", { name: "Search models" });
    fireEvent.change(input, { target: { value: "mutated" } });

    view.rerender(
      <ResponsiveDrawerShell open={false} onOpenChange={() => {}}>
        <input aria-label="Search models" defaultValue="keep" />
      </ResponsiveDrawerShell>,
    );
    await flush();
    expect(
      screen.getByRole("textbox", { name: "Search models", hidden: true }),
    ).toBe(input);
    expect(input).toHaveProperty("value", "mutated");

    view.rerender(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <input aria-label="Search models" defaultValue="keep" />
      </ResponsiveDrawerShell>,
    );
    await flush();
    expect(screen.getByRole("textbox", { name: "Search models" })).toBe(input);
  });

  it("uses the timer fallback when animation frames do not run", async () => {
    vi.useFakeTimers();
    mockPointerCoarse(true);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    render(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <button type="button">Project option</button>
      </ResponsiveDrawerShell>,
    );
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    expect(screen.getByRole("button", { name: "Project option" })).toBeTruthy();
  });

  it("opens without applying modal state to the app tree", async () => {
    mockPointerCoarse(true);
    const onContentAnimationEnd = vi.fn();
    const view = render(
      <>
        <main data-testid="large-app-tree" />
        <ResponsiveDrawerShell
          open={false}
          onOpenChange={() => {}}
          srLabel="Details"
          onContentAnimationEnd={onContentAnimationEnd}
        >
          <button type="button">Panel action</button>
        </ResponsiveDrawerShell>
      </>,
    );

    const appTree = screen.getByTestId("large-app-tree");
    expect(document.querySelector("[data-bb-sheet-content]")).toBeNull();
    expect(appTree.getAttribute("aria-hidden")).toBeNull();
    expect(appTree.hasAttribute("inert")).toBe(false);

    view.rerender(
      <>
        <main data-testid="large-app-tree" />
        <ResponsiveDrawerShell
          open={true}
          onOpenChange={() => {}}
          srLabel="Details"
          onContentAnimationEnd={onContentAnimationEnd}
        >
          <button type="button">Panel action</button>
        </ResponsiveDrawerShell>
      </>,
    );

    await waitFor(() => {
      expect(onContentAnimationEnd).toHaveBeenCalledWith(true);
    });
    expect(appTree.getAttribute("aria-hidden")).toBeNull();
    expect(appTree.hasAttribute("inert")).toBe(false);
    const backdrop = document.querySelector<HTMLElement>(
      "[data-bb-sheet-backdrop]",
    );
    expect(backdrop?.className).not.toContain("backdrop-blur");
  });

  it("closes from the backdrop exactly once per activation", async () => {
    mockPointerCoarse(true);
    const onOpenChange = vi.fn((next: boolean) => {
      void next;
    });
    render(
      <ResponsiveDrawerShell
        open={true}
        onOpenChange={onOpenChange}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </ResponsiveDrawerShell>,
    );
    await flush();

    const backdrop = document.querySelector<HTMLElement>(
      "[data-bb-sheet-backdrop]",
    );
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(backdrop).not.toBeNull();
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("data-state")).toBe("open");
    await act(async () => {
      fireEvent.pointerDown(backdrop as HTMLElement, {
        button: 0,
        pointerId: 1,
        clientX: 5,
        clientY: 5,
      });
      fireEvent.pointerUp(backdrop as HTMLElement, {
        button: 0,
        pointerId: 1,
        clientX: 5,
        clientY: 5,
      });
      fireEvent.click(backdrop as HTMLElement, { clientX: 5, clientY: 5 });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(
      onOpenChange.mock.calls.filter((call) => call[0] === false),
    ).toHaveLength(1);
  });

  it("closes from the Escape key", async () => {
    mockPointerCoarse(true);
    const onOpenChange = vi.fn();
    render(
      <ResponsiveDrawerShell
        open
        onOpenChange={onOpenChange}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </ResponsiveDrawerShell>,
    );
    await flush();
    const dialog = screen.getByRole("dialog", { name: "Details" });
    (dialog as HTMLElement).focus();
    fireEvent.keyDown(dialog, {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("Escape dismisses only the topmost open sheet, not a closed persistClosed shell", async () => {
    mockPointerCoarse(true);
    const onSidebarOpenChange = vi.fn();
    const onOverlayOpenChange = vi.fn();
    render(
      <>
        <ResponsiveDrawerShell
          open={false}
          onOpenChange={onSidebarOpenChange}
          srLabel="Sidebar"
          persistClosed
          contentPlacement="left"
        >
          <button type="button">Sidebar item</button>
        </ResponsiveDrawerShell>
        <ResponsiveDrawerShell
          open
          onOpenChange={onOverlayOpenChange}
          srLabel="Details"
        >
          <button type="button">Panel action</button>
        </ResponsiveDrawerShell>
      </>,
    );
    await flush();

    fireEvent.keyDown(document, {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
    });

    await waitFor(() => {
      expect(onOverlayOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onSidebarOpenChange).not.toHaveBeenCalled();
  });

  it("still settles terminal callbacks when reduced motion is off under jsdom", async () => {
    // jsdom still skips Silk spring travel (geometry), but reduced-motion
    // must not be the only path that reaches idleInside/idleOutside.
    mockPointerCoarse(true, { reducedMotion: false });
    const onContentAnimationEnd = vi.fn();
    const view = render(
      <ResponsiveDrawerShell
        open={true}
        onOpenChange={() => {}}
        srLabel="Details"
        onContentAnimationEnd={onContentAnimationEnd}
      >
        <button type="button">Panel action</button>
      </ResponsiveDrawerShell>,
    );

    await waitFor(() => {
      expect(onContentAnimationEnd).toHaveBeenCalledWith(true);
    });

    view.rerender(
      <ResponsiveDrawerShell
        open={false}
        onOpenChange={() => {}}
        srLabel="Details"
        onContentAnimationEnd={onContentAnimationEnd}
      >
        <button type="button">Panel action</button>
      </ResponsiveDrawerShell>,
    );

    await waitFor(() => {
      expect(onContentAnimationEnd).toHaveBeenCalledWith(false);
    });
    expect(
      onContentAnimationEnd.mock.calls.filter((call) => call[0] === true),
    ).toHaveLength(1);
    expect(
      onContentAnimationEnd.mock.calls.filter((call) => call[0] === false),
    ).toHaveLength(1);
  });

  it("emits one settled callback per terminal travel state", async () => {
    mockPointerCoarse(true);
    const onContentAnimationEnd = vi.fn();
    const view = render(
      <ResponsiveDrawerShell
        open={true}
        onOpenChange={() => {}}
        srLabel="Details"
        onContentAnimationEnd={onContentAnimationEnd}
      >
        <button type="button">Panel action</button>
      </ResponsiveDrawerShell>,
    );
    await waitFor(() => {
      expect(onContentAnimationEnd).toHaveBeenCalledWith(true);
    });
    expect(onContentAnimationEnd).toHaveBeenCalledTimes(1);

    view.rerender(
      <ResponsiveDrawerShell
        open={false}
        onOpenChange={() => {}}
        srLabel="Details"
        onContentAnimationEnd={onContentAnimationEnd}
      >
        <button type="button">Panel action</button>
      </ResponsiveDrawerShell>,
    );
    await waitFor(() => {
      expect(onContentAnimationEnd).toHaveBeenCalledWith(false);
    });
    expect(
      onContentAnimationEnd.mock.calls.filter((call) => call[0] === false),
    ).toHaveLength(1);
  });

  it("keeps the latest close callback after a parent rerender", async () => {
    mockPointerCoarse(true);
    const firstOnOpenChange = vi.fn();
    const nextOnOpenChange = vi.fn();
    const view = render(
      <ResponsiveDrawerShell
        open={true}
        onOpenChange={firstOnOpenChange}
        srLabel="Details"
      >
        <input aria-label="Panel input" />
      </ResponsiveDrawerShell>,
    );
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Panel input" })).toBeTruthy();
    });
    const input = screen.getByRole("textbox", { name: "Panel input" });
    input.focus();

    view.rerender(
      <ResponsiveDrawerShell
        open={true}
        onOpenChange={nextOnOpenChange}
        srLabel="Details"
      >
        <input aria-label="Panel input" />
      </ResponsiveDrawerShell>,
    );

    expect(document.activeElement).toBe(input);
    const backdrop = document.querySelector<HTMLElement>(
      "[data-bb-sheet-backdrop]",
    ) as HTMLElement;
    fireEvent.pointerDown(backdrop, {
      button: 0,
      pointerId: 1,
      clientX: 4,
      clientY: 4,
    });
    fireEvent.pointerUp(backdrop, {
      button: 0,
      pointerId: 1,
      clientX: 4,
      clientY: 4,
    });
    fireEvent.click(backdrop, { clientX: 4, clientY: 4 });
    await waitFor(() => {
      expect(nextOnOpenChange).toHaveBeenCalledWith(false);
    });
    expect(firstOnOpenChange).not.toHaveBeenCalled();
  });
});

describe("responsive Dialog", () => {
  it("links the persistent mobile dialog to its title and description", async () => {
    mockPointerCoarse(true);

    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <Dialog open>
          <DialogContent>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Choose a project location.</DialogDescription>
          </DialogContent>
        </Dialog>
      </CompactViewportOverrideProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "New project" }),
      ).toBeTruthy();
    });

    const dialog = screen.getByRole("dialog", { name: "New project" });
    expect(dialog.getAttribute("aria-describedby")).toContain(
      screen.getByText("Choose a project location.").id,
    );
  });

  it("uses custom IDs and asChild elements for mobile dialog labels", async () => {
    mockPointerCoarse(true);

    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <Dialog open>
          <DialogContent>
            <DialogTitle asChild id="custom-title">
              <h3>Custom project</h3>
            </DialogTitle>
            <DialogDescription asChild id="custom-description">
              <div>Custom project details.</div>
            </DialogDescription>
          </DialogContent>
        </Dialog>
      </CompactViewportOverrideProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Custom project" }),
      ).toBeTruthy();
    });

    const dialog = screen.getByRole("dialog", { name: "Custom project" });
    expect(screen.getByRole("heading", { level: 3 }).id).toBe("custom-title");
    expect(dialog.getAttribute("aria-labelledby")).toContain("custom-title");
    expect(dialog.getAttribute("aria-describedby")).toContain(
      "custom-description",
    );
    expect(document.querySelector("#custom-description")?.tagName).toBe("DIV");
  });
});
