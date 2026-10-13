// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppCommandProvider,
  useAppCommandHandler,
} from "@/components/commands/AppCommandProvider";
import {
  useWindowRightPanel,
  WindowRightPanelToggle,
} from "./WindowRightPanelToggle";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { showKeyboardHints: false },
      keybindings: [],
    },
  }),
}));

function Pane({
  isFocused,
  isOpen,
  onToggle,
}: {
  isFocused: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  useAppCommandHandler("panel.toggle", () => {
    if (!isFocused) return false;
    onToggle();
    return true;
  });
  useWindowRightPanel({ isOpen, enabled: isFocused });
  return null;
}

afterEach(cleanup);

describe("WindowRightPanelToggle", () => {
  it("renders nothing until a page registers a right panel", () => {
    render(
      <AppCommandProvider>
        <WindowRightPanelToggle />
      </AppCommandProvider>,
    );

    expect(screen.queryByTestId("window-right-panel-toggle")).toBeNull();
  });

  it("follows the focused pane's panel and toggles it through panel.toggle", () => {
    const firstToggle = vi.fn();
    const secondToggle = vi.fn();
    const view = render(
      <AppCommandProvider>
        <Pane isFocused isOpen onToggle={firstToggle} />
        <Pane isFocused={false} isOpen={false} onToggle={secondToggle} />
        <WindowRightPanelToggle />
      </AppCommandProvider>,
    );

    const toggle = screen.getByTestId("window-right-panel-toggle");
    expect(toggle.getAttribute("aria-label")).toBe("Hide right panel");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(firstToggle).toHaveBeenCalledTimes(1);
    expect(secondToggle).not.toHaveBeenCalled();

    view.rerender(
      <AppCommandProvider>
        <Pane isFocused={false} isOpen onToggle={firstToggle} />
        <Pane isFocused isOpen={false} onToggle={secondToggle} />
        <WindowRightPanelToggle />
      </AppCommandProvider>,
    );

    const refocused = screen.getByTestId("window-right-panel-toggle");
    expect(refocused.getAttribute("aria-label")).toBe("Show right panel");
    expect(refocused.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(refocused);
    expect(firstToggle).toHaveBeenCalledTimes(1);
    expect(secondToggle).toHaveBeenCalledTimes(1);
  });
});
