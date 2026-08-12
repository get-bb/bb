// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
import {
  PersistentResponsiveDrawerShell,
  ResponsiveDrawerShell,
} from "@bb/shared-ui/responsive-overlay";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mockPointerCoarse(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === POINTER_COARSE_QUERY && matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("ResponsiveDrawerShell", () => {
  it("starts the persistent shell before it realizes content two frames later", () => {
    mockPointerCoarse(true);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
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

      const content = document.querySelector<HTMLElement>(
        "[data-persistent-drawer-content]",
      );
      expect(content?.getAttribute("data-state")).toBe("open");
      expect(
        document.querySelector("[data-responsive-drawer-placeholder]"),
      ).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Choose model" })).toBeNull();
      expect(appTree.hasAttribute("inert")).toBe(false);
      expect(appTree.getAttribute("aria-hidden")).toBeNull();

      act(() => frames.shift()?.(0));
      expect(screen.queryByRole("button", { name: "Choose model" })).toBeNull();
      act(() => frames.shift()?.(16));
      expect(screen.getByRole("button", { name: "Choose model" })).toBeTruthy();
    } finally {
      appTree.remove();
    }
  });

  it("retains realized content across close and reopen", () => {
    mockPointerCoarse(true);
    const frames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });

    const view = render(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <input aria-label="Search models" />
      </ResponsiveDrawerShell>,
    );
    act(() => frames.shift()?.(0));
    act(() => frames.shift()?.(16));
    const input = screen.getByRole("textbox", { name: "Search models" });

    view.rerender(
      <ResponsiveDrawerShell open={false} onOpenChange={() => {}}>
        <input aria-label="Search models" />
      </ResponsiveDrawerShell>,
    );
    expect(
      screen.getByRole("textbox", { name: "Search models", hidden: true }),
    ).toBe(input);

    view.rerender(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <input aria-label="Search models" />
      </ResponsiveDrawerShell>,
    );
    expect(screen.getByRole("textbox", { name: "Search models" })).toBe(input);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it("uses the timer fallback when animation frames do not run", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    render(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <button type="button">Project option</button>
      </ResponsiveDrawerShell>,
    );
    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByRole("button", { name: "Project option" })).toBeTruthy();
  });
});

describe("responsive Dialog", () => {
  it("links the persistent mobile dialog to its title and description", () => {
    mockPointerCoarse(true);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

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

    act(() => frames.shift()?.(0));
    act(() => frames.shift()?.(16));

    const dialog = screen.getByRole("dialog", { name: "New project" });
    expect(dialog.getAttribute("aria-describedby")).toBe(
      screen.getByText("Choose a project location.").id,
    );
  });
});

describe("PersistentResponsiveDrawerShell", () => {
  it("opens without applying modal state to the app tree", () => {
    mockPointerCoarse(true);
    const onContentAnimationEnd = vi.fn();
    const view = render(
      <>
        <main data-testid="large-app-tree" />
        <PersistentResponsiveDrawerShell
          open={false}
          onOpenChange={() => {}}
          srLabel="Details"
          onContentAnimationEnd={onContentAnimationEnd}
        >
          <button type="button">Panel action</button>
        </PersistentResponsiveDrawerShell>
      </>,
    );

    const appTree = screen.getByTestId("large-app-tree");
    const content = document.querySelector<HTMLElement>(
      "[data-persistent-drawer-content]",
    );
    expect(content).not.toBeNull();
    expect(content?.getAttribute("aria-hidden")).toBe("true");
    expect(appTree.getAttribute("aria-hidden")).toBeNull();
    expect(appTree.hasAttribute("inert")).toBe(false);

    view.rerender(
      <>
        <main data-testid="large-app-tree" />
        <PersistentResponsiveDrawerShell
          open={true}
          onOpenChange={() => {}}
          srLabel="Details"
          onContentAnimationEnd={onContentAnimationEnd}
        >
          <button type="button">Panel action</button>
        </PersistentResponsiveDrawerShell>
      </>,
    );

    expect(content?.getAttribute("aria-hidden")).toBe("false");
    expect(appTree.getAttribute("aria-hidden")).toBeNull();
    fireEvent.transitionEnd(content as HTMLElement, {
      propertyName: "transform",
    });
    expect(onContentAnimationEnd).toHaveBeenLastCalledWith(true);
  });

  it("closes from the backdrop and the Escape key", () => {
    mockPointerCoarse(true);
    const onOpenChange = vi.fn();
    render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={onOpenChange}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </PersistentResponsiveDrawerShell>,
    );

    fireEvent.click(
      document.querySelector<HTMLElement>(
        "[data-persistent-drawer-backdrop]",
      ) as HTMLElement,
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("lets a nested portaled surface handle Escape first", () => {
    mockPointerCoarse(true);
    const onOpenChange = vi.fn();
    render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={onOpenChange}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </PersistentResponsiveDrawerShell>,
    );

    const nestedAction = document.createElement("button");
    nestedAction.addEventListener("keydown", (event) => {
      event.preventDefault();
    });
    document.body.appendChild(nestedAction);

    try {
      fireEvent.keyDown(nestedAction, { key: "Escape" });
      expect(onOpenChange).not.toHaveBeenCalled();
    } finally {
      nestedAction.remove();
    }
  });

  it("does not take Tab focus from a portaled child surface", () => {
    mockPointerCoarse(true);
    render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={() => {}}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </PersistentResponsiveDrawerShell>,
    );

    const nestedAction = document.createElement("button");
    document.body.appendChild(nestedAction);
    nestedAction.focus();

    try {
      fireEvent.keyDown(nestedAction, { key: "Tab" });
      expect(document.activeElement).toBe(nestedAction);
      fireEvent.keyDown(nestedAction, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(nestedAction);
    } finally {
      nestedAction.remove();
    }
  });

  it("keeps panel focus and uses the latest close callback after a parent rerender", () => {
    mockPointerCoarse(false);
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(performance.now());
        return 1;
      });
    const firstOnOpenChange = vi.fn();
    const nextOnOpenChange = vi.fn();
    const view = render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={firstOnOpenChange}
        srLabel="Details"
      >
        <input aria-label="Panel input" />
      </PersistentResponsiveDrawerShell>,
    );
    const input = screen.getByRole("textbox", { name: "Panel input" });
    input.focus();

    view.rerender(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={nextOnOpenChange}
        srLabel="Details"
      >
        <input aria-label="Panel input" />
      </PersistentResponsiveDrawerShell>,
    );

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
    fireEvent.click(
      document.querySelector<HTMLElement>(
        "[data-persistent-drawer-backdrop]",
      ) as HTMLElement,
    );
    expect(firstOnOpenChange).not.toHaveBeenCalled();
    expect(nextOnOpenChange).toHaveBeenCalledWith(false);
    requestAnimationFrame.mockRestore();
  });

  it("closes when the handle moves past the drag threshold", () => {
    mockPointerCoarse(true);
    const onOpenChange = vi.fn();
    render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={onOpenChange}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </PersistentResponsiveDrawerShell>,
    );

    const content = document.querySelector<HTMLElement>(
      "[data-persistent-drawer-content]",
    ) as HTMLElement;
    const handle = document.querySelector<HTMLElement>(
      "[data-persistent-drawer-handle]",
    ) as HTMLElement;
    const readHeight = vi.fn(() => 400);
    Object.defineProperty(content, "clientHeight", {
      configurable: true,
      get: readHeight,
    });
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 200,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, { clientY: 330, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 330, pointerId: 1 });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(readHeight).toHaveBeenCalledTimes(1);
  });
});
