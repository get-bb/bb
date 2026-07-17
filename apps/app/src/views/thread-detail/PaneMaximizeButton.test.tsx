// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    isBoundedPane: true,
    isTopRow: true,
    navigateInPane: noop,
  };
  return render(
    <TooltipProvider>
      <PaneContext.Provider value={value}>
        <PaneMaximizeButton />
      </PaneContext.Provider>
    </TooltipProvider>,
  );
}

afterEach(cleanup);

describe("PaneMaximizeButton", () => {
  it("exposes the maximize action, shortcut, and pressed state", () => {
    const onToggle = vi.fn();
    renderButton(false, onToggle);
    const button = screen.getByRole("button", { name: "Maximize pane (⌘⇧E)" });

    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+E");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("changes to restore while maximized", () => {
    renderButton(true);
    const button = screen.getByRole("button", { name: "Restore pane (⌘⇧E)" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
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
