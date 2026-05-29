// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadDetailHeader } from "./ThreadDetailHeader";

vi.mock("@/components/ui/hooks/use-compact-viewport.js", () => ({
  useIsCompactViewport: () => false,
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  SidebarTrigger: () => null,
  useIsSidebarShowing: () => true,
}));

interface RenderHeaderOverrides {
  isSecondaryPanelOpen?: boolean;
  onToggleSecondaryPanel?: () => void;
}

function renderHeader(overrides: RenderHeaderOverrides = {}) {
  const noop = () => {};
  const props = {
    actionsMenu: null,
    activeTerminalCount: 0,
    isManagedThread: false,
    isManagerThread: false,
    isSecondaryPanelOpen: overrides.isSecondaryPanelOpen ?? false,
    isTerminalPanelOpen: false,
    isThreadGitActionPending: false,
    onOpenThreadGitAction: noop,
    onToggleSecondaryPanel: overrides.onToggleSecondaryPanel ?? noop,
    onToggleTerminalPanel: noop,
    showTerminalPanelToggle: false,
    threadHeaderGitActions: [],
    threadTitle: "Test thread",
  };
  return render(<ThreadDetailHeader {...props} />);
}

afterEach(() => {
  cleanup();
});

describe("ThreadDetailHeader panel toggle", () => {
  it("opens the secondary panel from the closed state", () => {
    const onToggleSecondaryPanel = vi.fn();
    renderHeader({
      isSecondaryPanelOpen: false,
      onToggleSecondaryPanel,
    });

    const button = screen.getByRole("button", { name: "Show panel" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // Closed state renders the recognizable panel icon, not a chevron, so it
    // reads as "open the right side panel".
    expect(button.querySelector("[data-icon='PanelRight']")).not.toBeNull();

    fireEvent.click(button);
    expect(onToggleSecondaryPanel).toHaveBeenCalledTimes(1);
  });

  it("drops the panel toggle from the conversation header once the panel is open", () => {
    // Open state moves the expand/collapse-conversation toggle into the panel
    // header, so the conversation header no longer carries a panel affordance.
    renderHeader({ isSecondaryPanelOpen: true });

    expect(screen.queryByRole("button", { name: "Show panel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand panel" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore conversation" }),
    ).toBeNull();
  });
});
