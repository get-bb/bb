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
  isConversationCollapsed?: boolean;
  onToggleSecondaryPanel?: () => void;
  onToggleConversationCollapse?: () => void;
}

function renderHeader(overrides: RenderHeaderOverrides = {}) {
  const noop = () => {};
  const props = {
    actionsMenu: null,
    activeTerminalCount: 0,
    isConversationCollapsed: overrides.isConversationCollapsed ?? false,
    isManagedThread: false,
    isManagerThread: false,
    isSecondaryPanelOpen: overrides.isSecondaryPanelOpen ?? false,
    isTerminalPanelOpen: false,
    isThreadGitActionPending: false,
    onOpenThreadGitAction: noop,
    onToggleConversationCollapse:
      overrides.onToggleConversationCollapse ?? noop,
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

describe("ThreadDetailHeader panel toggle chevron", () => {
  it("opens the secondary panel from the closed state", () => {
    const onToggleSecondaryPanel = vi.fn();
    const onToggleConversationCollapse = vi.fn();
    renderHeader({
      isSecondaryPanelOpen: false,
      isConversationCollapsed: false,
      onToggleSecondaryPanel,
      onToggleConversationCollapse,
    });

    const button = screen.getByRole("button", { name: "Show panel" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // Closed state renders the recognizable panel icon, not a chevron, so it
    // reads as "open the right side panel".
    expect(button.querySelector("[data-icon='PanelRight']")).not.toBeNull();

    fireEvent.click(button);
    expect(onToggleSecondaryPanel).toHaveBeenCalledTimes(1);
    expect(onToggleConversationCollapse).not.toHaveBeenCalled();
  });

  it("collapses the conversation when the panel is open and shown", () => {
    const onToggleSecondaryPanel = vi.fn();
    const onToggleConversationCollapse = vi.fn();
    renderHeader({
      isSecondaryPanelOpen: true,
      isConversationCollapsed: false,
      onToggleSecondaryPanel,
      onToggleConversationCollapse,
    });

    const button = screen.getByRole("button", { name: "Expand panel" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // Open + conversation shown keeps the directional chevron (this collapses
    // the conversation — a different action from opening the panel).
    expect(button.querySelector("[data-icon='ChevronLeft']")).not.toBeNull();

    fireEvent.click(button);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleSecondaryPanel).not.toHaveBeenCalled();
  });
});
