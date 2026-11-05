// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { DropdownMenuItem } from "@bb/shared-ui/dropdown-menu";
import { CompactLongPressMenu } from "@bb/shared-ui/compact-long-press-menu";

const LONG_PRESS_MS = 700;

function renderRow({
  disabled = false,
  onRowClick = vi.fn(),
  onOpenChange = vi.fn(),
  onRename = vi.fn(),
}: {
  disabled?: boolean;
  onRowClick?: () => void;
  onOpenChange?: (open: boolean) => void;
  onRename?: () => void;
} = {}) {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  const utils = render(
    <CompactViewportOverrideProvider isCompactViewport>
      <CompactLongPressMenu
        disabled={disabled}
        label="Thread actions"
        onOpenChange={onOpenChange}
        items={<DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>}
      >
        <a href="#thread" onClick={onRowClick} data-testid="row">
          Thread row
        </a>
      </CompactLongPressMenu>
    </CompactViewportOverrideProvider>,
    { container: root },
  );
  return {
    ...utils,
    row: screen.getByTestId("row"),
    onRowClick,
    onOpenChange,
    onRename,
  };
}

function touchPointerDown(target: Element, x = 100, y = 100) {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
}

afterEach(() => {
  cleanup();
  document.getElementById("root")?.remove();
  vi.useRealTimers();
});

describe("CompactLongPressMenu", () => {
  it("preserves touch selection and the native context menu while disabled", () => {
    vi.useFakeTimers();
    const { row, onOpenChange } = renderRow({ disabled: true });

    touchPointerDown(row);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(row, event);

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("mounts nothing for the menu until a long press, then opens the drawer without a modal takeover", () => {
    vi.useFakeTimers();
    const { row, onOpenChange } = renderRow();

    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(document.querySelector("[role='dialog']")).toBeNull();

    touchPointerDown(row);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();

    const root = document.getElementById("root");
    expect(root?.getAttribute("aria-hidden")).toBeNull();
    expect(root?.hasAttribute("inert")).toBe(false);
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("swallows the click that follows a long press so the row does not navigate", () => {
    vi.useFakeTimers();
    const { row, onRowClick } = renderRow();

    touchPointerDown(row);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.pointerUp(row, { pointerId: 1, pointerType: "touch" });
    fireEvent.click(row);
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.click(row);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("ignores the opening release on a menu item but allows a new tap", () => {
    vi.useFakeTimers();
    const { row, onRename } = renderRow();
    touchPointerDown(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    act(() => vi.advanceTimersByTime(500));
    const item = screen.getByRole("menuitem", { name: "Rename" });
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(item);
    expect(onRename).not.toHaveBeenCalled();
    touchPointerDown(item);
    fireEvent.click(item);
    expect(onRename).toHaveBeenCalledOnce();
  });

  it("ignores the opening release on the drawer backdrop but allows a fresh tap to dismiss", () => {
    vi.useFakeTimers();
    const { row, onOpenChange } = renderRow();
    touchPointerDown(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 500));
    const backdrop = document.querySelector(
      "[data-persistent-drawer-backdrop][data-state='open']",
    );
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    touchPointerDown(backdrop!);
    fireEvent.click(backdrop!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cancels the press when the finger moves or lifts early, and ignores mouse pointers", () => {
    vi.useFakeTimers();
    const { row, onOpenChange, onRowClick } = renderRow();

    touchPointerDown(row, 100, 100);
    fireEvent.pointerMove(row, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 130,
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onOpenChange).not.toHaveBeenCalled();

    touchPointerDown(row, 100, 100);
    fireEvent.pointerUp(row, { pointerId: 1, pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(row, {
      pointerId: 2,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(row);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("does not open when the press catches a moving list or the list scrolls the row away, but ignores settling scrolls", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <div data-testid="sidebar-scroller">
          <CompactLongPressMenu
            label="Thread actions"
            onOpenChange={onOpenChange}
            items={<DropdownMenuItem>Rename</DropdownMenuItem>}
          >
            <a href="#thread" data-testid="row">
              Thread row
            </a>
          </CompactLongPressMenu>
        </div>
        <div data-testid="timeline-scroller" />
      </CompactViewportOverrideProvider>,
    );
    const row = screen.getByTestId("row");
    const sidebarScroller = screen.getByTestId("sidebar-scroller");
    const timelineScroller = screen.getByTestId("timeline-scroller");
    const scrollTo = (scroller: HTMLElement, top: number) => {
      Object.defineProperty(scroller, "scrollTop", {
        configurable: true,
        value: top,
      });
      fireEvent.scroll(scroller);
    };
    const liftFinger = () =>
      fireEvent.pointerUp(row, { pointerId: 1, pointerType: "touch" });

    scrollTo(sidebarScroller, 0);
    act(() => vi.advanceTimersByTime(16));
    scrollTo(sidebarScroller, 20);
    touchPointerDown(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    liftFinger();
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));
    touchPointerDown(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS / 2));
    const rowRect = vi
      .spyOn(row, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, -30, 100, 40));
    scrollTo(sidebarScroller, 50);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    liftFinger();
    rowRect.mockRestore();
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));
    scrollTo(timelineScroller, 0);
    act(() => vi.advanceTimersByTime(16));
    scrollTo(timelineScroller, 40);
    scrollTo(sidebarScroller, 50);
    act(() => vi.advanceTimersByTime(16));
    scrollTo(sidebarScroller, 50.5);
    touchPointerDown(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS / 2));
    scrollTo(sidebarScroller, 50.5);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("does not open when the row is no longer under the finger, as when the sidebar opens or closes mid-press", () => {
    vi.useFakeTimers();
    const { row, onOpenChange } = renderRow();
    const coveringView = document.createElement("main");
    document.body.appendChild(coveringView);

    const elementFromPoint = vi
      .spyOn(document, "elementFromPoint")
      .mockReturnValue(coveringView);

    touchPointerDown(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onOpenChange).not.toHaveBeenCalled();

    elementFromPoint.mockRestore();
    touchPointerDown(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    coveringView.remove();
  });

  it("applies the touch guards to the browser's own long-press contextmenu", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const onRowClick = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <div data-testid="sidebar-scroller">
          <CompactLongPressMenu
            label="Thread actions"
            onOpenChange={onOpenChange}
            items={<DropdownMenuItem>Rename</DropdownMenuItem>}
          >
            <a href="#thread" onClick={onRowClick} data-testid="row">
              Thread row
            </a>
          </CompactLongPressMenu>
        </div>
      </CompactViewportOverrideProvider>,
    );
    const row = screen.getByTestId("row");
    const sidebarScroller = screen.getByTestId("sidebar-scroller");
    const scrollTo = (top: number) => {
      Object.defineProperty(sidebarScroller, "scrollTop", {
        configurable: true,
        value: top,
      });
      fireEvent.scroll(sidebarScroller);
    };
    const longPressContextMenu = () => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });
      fireEvent(row, event);
      return event;
    };
    const liftFinger = () =>
      fireEvent.pointerUp(row, { pointerId: 1, pointerType: "touch" });

    scrollTo(0);
    act(() => vi.advanceTimersByTime(16));
    scrollTo(20);
    touchPointerDown(row);
    act(() => vi.advanceTimersByTime(500));
    expect(longPressContextMenu().defaultPrevented).toBe(true);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    liftFinger();
    expect(onOpenChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));
    touchPointerDown(row);
    const coveringView = document.createElement("main");
    document.body.appendChild(coveringView);
    const elementFromPoint = vi
      .spyOn(document, "elementFromPoint")
      .mockReturnValue(coveringView);
    act(() => vi.advanceTimersByTime(500));
    expect(longPressContextMenu().defaultPrevented).toBe(true);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    liftFinger();
    elementFromPoint.mockRestore();
    coveringView.remove();
    expect(onOpenChange).not.toHaveBeenCalled();

    touchPointerDown(row);
    act(() => vi.advanceTimersByTime(500));
    longPressContextMenu();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    liftFinger();
    fireEvent.click(row);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("lets only the innermost menu open when menus nest (thread row inside a project section)", () => {
    vi.useFakeTimers();
    const onProjectOpenChange = vi.fn();
    const onThreadOpenChange = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <CompactLongPressMenu
          label="Project actions"
          onOpenChange={onProjectOpenChange}
          items={<DropdownMenuItem>Rename project</DropdownMenuItem>}
        >
          <div data-testid="project-section">
            <span>Project</span>
            <CompactLongPressMenu
              label="Thread actions"
              onOpenChange={onThreadOpenChange}
              items={<DropdownMenuItem>Rename thread</DropdownMenuItem>}
            >
              <a href="#thread" data-testid="row">
                Thread row
              </a>
            </CompactLongPressMenu>
          </div>
        </CompactLongPressMenu>
      </CompactViewportOverrideProvider>,
    );
    const row = screen.getByTestId("row");

    touchPointerDown(row);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onThreadOpenChange).toHaveBeenCalledWith(true);
    expect(onProjectOpenChange).not.toHaveBeenCalled();

    onThreadOpenChange.mockClear();
    fireEvent.contextMenu(row);
    expect(onThreadOpenChange).toHaveBeenCalledWith(true);
    expect(onProjectOpenChange).not.toHaveBeenCalled();

    touchPointerDown(screen.getByText("Project"));
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onProjectOpenChange).toHaveBeenCalledWith(true);
  });

  it("lets only the innermost menu open when the menus come from separately bundled copies", async () => {
    vi.useFakeTimers();
    const pluginBundleSpecifier =
      "@bb/shared-ui/compact-long-press-menu?plugin-bundle";
    const pluginBundleCopy: typeof import("@bb/shared-ui/compact-long-press-menu") =
      await import(pluginBundleSpecifier);
    expect(pluginBundleCopy.CompactLongPressMenu).not.toBe(
      CompactLongPressMenu,
    );
    const ProjectMenu = pluginBundleCopy.CompactLongPressMenu;
    const onProjectOpenChange = vi.fn();
    const onThreadOpenChange = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <ProjectMenu
          label="Project actions"
          onOpenChange={onProjectOpenChange}
          items={<DropdownMenuItem>Rename project</DropdownMenuItem>}
        >
          <div>
            <span>Project</span>
            <CompactLongPressMenu
              label="Thread actions"
              onOpenChange={onThreadOpenChange}
              items={<DropdownMenuItem>Rename thread</DropdownMenuItem>}
            >
              <a href="#thread" data-testid="row">
                Thread row
              </a>
            </CompactLongPressMenu>
          </div>
        </ProjectMenu>
      </CompactViewportOverrideProvider>,
    );

    touchPointerDown(screen.getByTestId("row"));
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onThreadOpenChange).toHaveBeenCalledWith(true);
    expect(onProjectOpenChange).not.toHaveBeenCalled();
  });

  it("opens from a right-click on a narrow window without the native menu", () => {
    const { row, onOpenChange } = renderRow();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(row, event);
    expect(event.defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("cancels a pending actions menu when dragging begins", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const renderMenu = (dragging: boolean) => (
      <CompactLongPressMenu
        label="Thread actions"
        dragging={dragging}
        items={<button type="button">Action</button>}
        onOpenChange={onOpenChange}
      >
        <button type="button">Thread</button>
      </CompactLongPressMenu>
    );
    const { getByRole, rerender } = render(renderMenu(false));
    fireEvent.pointerDown(getByRole("button", { name: "Thread" }), {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    rerender(renderMenu(true));
    act(() => vi.advanceTimersByTime(800));

    expect(onOpenChange).not.toHaveBeenCalledWith(true);
  });

  it("dismisses an open actions menu when dragging begins", () => {
    const onOpenChange = vi.fn();
    const renderMenu = (dragging: boolean) => (
      <CompactLongPressMenu
        label="Thread actions"
        dragging={dragging}
        items={<button type="button">Action</button>}
        onOpenChange={onOpenChange}
      >
        <button type="button">Thread</button>
      </CompactLongPressMenu>
    );
    const { getByRole, rerender } = render(renderMenu(false));
    fireEvent.contextMenu(getByRole("button", { name: "Thread" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(renderMenu(true));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
