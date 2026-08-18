// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneContext, type PaneContextValue } from "./PaneContext";
import { PaneMaximizeButton } from "./PaneMaximizeButton";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => ({
    ariaKeyshortcuts: "Meta+Shift+E",
    label: "⌘⇧E",
  }),
}));

const noop = () => {};

function renderButton(
  isMaximized: boolean,
  onToggleMaximize: () => void = noop,
  onMoveToSide: PaneContextValue["onMoveToSide"] = noop,
) {
  const value: PaneContextValue = {
    paneId: "pane-1",
    isFocused: true,
    isSplitPane: true,
    secondaryPanelHost: null,
    reservesWindowPanelToggle: false,
    onRequestClose: noop,
    isMaximized,
    onToggleMaximize,
    onMoveToSide,
    isBoundedPane: true,
    isTopRow: true,
    ownsWindowTopLeft: true,
    navigateInPane: noop,
  };
  return render(
    <TooltipProvider delayDuration={0}>
      <PaneContext.Provider value={value}>
        <PaneMaximizeButton />
      </PaneContext.Provider>
    </TooltipProvider>,
  );
}

afterEach(cleanup);

describe("PaneMaximizeButton", () => {
  it("enters full screen immediately on the default click", () => {
    const onToggle = vi.fn();
    renderButton(false, onToggle);
    const button = screen.getByRole("button", { name: "Full Screen (⌘⇧E)" });

    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+E");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("exits full screen on click and uses the clear tooltip copy", async () => {
    const onToggle = vi.fn();
    renderButton(true, onToggle);
    const button = screen.getByRole("button", {
      name: "Exit Full Screen (⌘⇧E)",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");

    fireEvent.focus(button);
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("tooltip")
          .some((tooltip) => tooltip.textContent?.includes("Exit Full Screen")),
      ).toBe(true);
    });

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows only BB's supported split arrangement actions on hover", async () => {
    const onMoveToSide = vi.fn();
    renderButton(false, noop, onMoveToSide);
    const button = screen.getByRole("button", { name: "Full Screen (⌘⇧E)" });

    fireEvent.pointerEnter(button);
    const menu = await screen.findByRole("menu", { name: "Pane arrangement" });
    expect(menu.textContent).toContain("Full Screen");
    expect(menu.textContent).toContain("Move");
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Full Screen⌘⇧E", "", "", "", ""]);
    for (const side of ["left", "right", "top", "bottom"]) {
      const action = screen.getByRole("menuitem", {
        name: `Move ${side}`,
      });
      expect(
        action.querySelector(`[data-pane-arrangement-glyph="${side}"]`),
      ).not.toBeNull();
      expect(action.className).toContain("cursor-pointer");
    }
    expect(
      screen.getByRole("menuitem", { name: /Full Screen/ }).className,
    ).toContain("cursor-pointer");

    fireEvent.click(screen.getByRole("menuitem", { name: "Move left" }));
    expect(onMoveToSide).toHaveBeenCalledWith("left");
  });

  it("keeps the menu closed while the pointer only passes over the button", async () => {
    renderButton(false);
    const button = screen.getByRole("button", { name: "Full Screen (⌘⇧E)" });

    fireEvent.pointerEnter(button);
    fireEvent.pointerLeave(button);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByRole("menu", { name: "Pane arrangement" })).toBeNull();
  });

  it("does not render outside a multi-pane workspace", () => {
    const value: PaneContextValue = {
      paneId: "main",
      isFocused: true,
      isSplitPane: false,
      secondaryPanelHost: null,
      reservesWindowPanelToggle: false,
      onRequestClose: null,
      isMaximized: false,
      onToggleMaximize: null,
      isBoundedPane: false,
      isTopRow: true,
      ownsWindowTopLeft: true,
      navigateInPane: noop,
    };
    render(
      <PaneContext.Provider value={value}>
        <PaneMaximizeButton />
      </PaneContext.Provider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
