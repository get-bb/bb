// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeamPanelArrow } from "./SeamPanelArrow";

afterEach(() => {
  cleanup();
});

describe("SeamPanelArrow", () => {
  it("reveals the panel when the secondary panel is closed", () => {
    const onToggleSecondaryPanel = vi.fn();
    const onToggleConversationCollapse = vi.fn();
    render(
      <SeamPanelArrow
        isSecondaryPanelOpen={false}
        isConversationCollapsed={false}
        onToggleSecondaryPanel={onToggleSecondaryPanel}
        onToggleConversationCollapse={onToggleConversationCollapse}
      />,
    );

    const button = screen.getByRole("button", { name: "Show panel" });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(onToggleSecondaryPanel).toHaveBeenCalledTimes(1);
    expect(onToggleConversationCollapse).not.toHaveBeenCalled();
  });

  it("collapses the conversation when the panel is open and expanded", () => {
    const onToggleSecondaryPanel = vi.fn();
    const onToggleConversationCollapse = vi.fn();
    render(
      <SeamPanelArrow
        isSecondaryPanelOpen
        isConversationCollapsed={false}
        onToggleSecondaryPanel={onToggleSecondaryPanel}
        onToggleConversationCollapse={onToggleConversationCollapse}
      />,
    );

    const button = screen.getByRole("button", { name: "Expand panel" });
    // The conversation is still shown, so the disclosure reads expanded.
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(button);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleSecondaryPanel).not.toHaveBeenCalled();
  });

  it("expands the conversation when it is collapsed", () => {
    const onToggleSecondaryPanel = vi.fn();
    const onToggleConversationCollapse = vi.fn();
    render(
      <SeamPanelArrow
        isSecondaryPanelOpen
        isConversationCollapsed
        onToggleSecondaryPanel={onToggleSecondaryPanel}
        onToggleConversationCollapse={onToggleConversationCollapse}
      />,
    );

    const button = screen.getByRole("button", { name: "Expand conversation" });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleSecondaryPanel).not.toHaveBeenCalled();
  });
});
