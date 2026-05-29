import { describe, expect, it, vi } from "vitest";
import { resolvePanelToggleControl } from "./panelToggleControlState";

describe("resolvePanelToggleControl", () => {
  it("opens the panel when the panel is closed", () => {
    const onToggleSecondaryPanel = vi.fn();
    const onToggleConversationCollapse = vi.fn();
    const state = resolvePanelToggleControl({
      isSecondaryPanelOpen: false,
      isConversationCollapsed: false,
      onToggleSecondaryPanel,
      onToggleConversationCollapse,
    });

    expect(state.action).toBe("show-panel");
    expect(state.label).toBe("Show panel");
    expect(state.isExpanded).toBe(false);
    expect(state.pointsRight).toBe(false);

    state.onClick();
    expect(onToggleSecondaryPanel).toHaveBeenCalledTimes(1);
    expect(onToggleConversationCollapse).not.toHaveBeenCalled();
  });

  it("collapses the conversation when the panel is open and the conversation is shown", () => {
    const onToggleSecondaryPanel = vi.fn();
    const onToggleConversationCollapse = vi.fn();
    const state = resolvePanelToggleControl({
      isSecondaryPanelOpen: true,
      isConversationCollapsed: false,
      onToggleSecondaryPanel,
      onToggleConversationCollapse,
    });

    expect(state.action).toBe("expand-panel");
    expect(state.label).toBe("Expand panel");
    expect(state.isExpanded).toBe(true);
    expect(state.pointsRight).toBe(false);

    state.onClick();
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleSecondaryPanel).not.toHaveBeenCalled();
  });

  it("restores the conversation when it is collapsed", () => {
    const onToggleSecondaryPanel = vi.fn();
    const onToggleConversationCollapse = vi.fn();
    const state = resolvePanelToggleControl({
      isSecondaryPanelOpen: true,
      isConversationCollapsed: true,
      onToggleSecondaryPanel,
      onToggleConversationCollapse,
    });

    expect(state.action).toBe("expand-conversation");
    expect(state.label).toBe("Expand conversation");
    expect(state.isExpanded).toBe(false);
    expect(state.pointsRight).toBe(true);

    state.onClick();
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
    expect(onToggleSecondaryPanel).not.toHaveBeenCalled();
  });
});
