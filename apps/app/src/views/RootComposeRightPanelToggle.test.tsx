// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveRootComposePanelTogglePlacement,
  RootComposeRightPanelToggle,
} from "./RootComposeView";

afterEach(cleanup);

describe("RootComposeRightPanelToggle", () => {
  it("hands the floating control off to aligned panel chrome when open", () => {
    expect(
      resolveRootComposePanelTogglePlacement({
        isHosted: false,
        isOpen: false,
      }),
    ).toEqual({ inlinePanelToggle: "button", showPinnedToggle: true });
    expect(
      resolveRootComposePanelTogglePlacement({ isHosted: false, isOpen: true }),
    ).toEqual({ inlinePanelToggle: "button", showPinnedToggle: false });
    expect(
      resolveRootComposePanelTogglePlacement({ isHosted: true, isOpen: true }),
    ).toEqual({ inlinePanelToggle: "button", showPinnedToggle: false });
  });

  it("uses a disclosure state without painting the whole click target as selected", () => {
    const onToggle = vi.fn();

    render(<RootComposeRightPanelToggle isOpen onToggle={onToggle} />);

    const button = screen.getByRole("button", { name: "Hide right panel" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-pressed")).toBeNull();

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
