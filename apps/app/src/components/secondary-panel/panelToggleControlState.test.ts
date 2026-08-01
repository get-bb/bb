import { describe, expect, it, vi } from "vitest";
import {
  resolveConversationCollapseControl,
  resolveShowPanelControl,
} from "./panelToggleControlState";

describe("resolveShowPanelControl", () => {
  it("opens the panel and reads as a closed disclosure", () => {
    const onToggleSecondaryPanel = vi.fn();
    const state = resolveShowPanelControl({ onToggleSecondaryPanel });

    expect(state.action).toBe("show-panel");
    expect(state.label).toBe("Show right panel");
    expect(state.isExpanded).toBe(false);
    // The recognizable panel icon reads as "open the right side panel".
    expect(state.iconName).toBe("PanelRight");

    state.onClick();
    expect(onToggleSecondaryPanel).toHaveBeenCalledTimes(1);
  });
});

describe("resolveConversationCollapseControl", () => {
  it("collapses the conversation when it is shown", () => {
    const onToggleConversationCollapse = vi.fn();
    const state = resolveConversationCollapseControl({
      isConversationCollapsed: false,
      onToggleConversationCollapse,
    });

    expect(state.action).toBe("expand-panel");
    expect(state.label).toBe("Expand right panel");
    // The conversation is currently expanded; clicking collapses it.
    expect(state.isExpanded).toBe(true);
    // The shared four-arrow glyph clearly expands the panel to fill the canvas.
    expect(state.iconName).toBe("Maximize2");

    state.onClick();
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });

  it("restores the conversation when it is collapsed", () => {
    const onToggleConversationCollapse = vi.fn();
    const state = resolveConversationCollapseControl({
      isConversationCollapsed: true,
      onToggleConversationCollapse,
    });

    expect(state.action).toBe("restore-conversation");
    expect(state.label).toBe("Restore conversation");
    expect(state.isExpanded).toBe(false);
    // The matching four-arrow collapse glyph restores the split layout.
    expect(state.iconName).toBe("Minimize2");

    state.onClick();
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });
});
